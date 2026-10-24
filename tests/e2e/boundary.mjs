// Boundary verification of the Ge'orama shell (authorized, defensive, loopback-only fixtures).
// Run: npm run build && node tests/e2e/boundary.mjs        (hidden Electron; never writes into the repo)
// Dev filter: BOUNDARY_ONLY='<regex on probe names>' runs a subset.
// All attacker actions execute in a CSP-governed, same-origin external script placed in a DISPOSABLE
// copy of the build under $TMPDIR; the inspector is a test-only observation/fixture channel.
// Exit 0 only with no FAIL. An ACCEPTED-RISK is a reasoned, printed exception, never a pass, and a
// network egress channel can never be one. Report: $TMPDIR/georama-boundary-report-<pid>.json
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, mkdir, symlink, cp } from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import dgram from 'node:dgram';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const run = promisify(execFile);
let appRoot, rendererRoot, assets, indexPath;
const reportPath = path.join(os.tmpdir(), `georama-boundary-report-${process.pid}.json`);
const results = [];
const connections = [];
const children = new Set();
const servers = [];
let temporaryDirectory, originalIndex, cleanupPromise;
let page, main, child, rendererPort, mainPort;
const netlogs = [];
const editorUrl = 'georama://app/index.html';
const only = process.env.BOUNDARY_ONLY ? new RegExp(process.env.BOUNDARY_ONLY) : null;
let currentAction = 'startup';
const evidence = { http: [], tcp: [], udp: [], normalSockets: [], debugSockets: [], observations: {} };
let observedCommit;
// name -> { reason, evidence, owner }. Egress channels (requests, workers, WebRTC, DNS) may never be listed.
const ACCEPTED_RISKS = new Map([
]);
for (const name of ACCEPTED_RISKS.keys()) {
  if (/egress|webrtc|worker|hostname|dns|fetch|socket/i.test(name)) throw new Error('A network egress probe cannot be an accepted risk: ' + name);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function targetAt(port, predicate) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Electron exited: ${child.exitCode ?? child.signalCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) });
      const target = (await response.json()).find(predicate);
      if (target?.webSocketDebuggerUrl) return target;
    } catch { /* startup */ }
    await delay(100);
  }
  throw new Error(`No debugging target on ${port}`);
}
async function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map(), listeners = new Map();
  let sequence = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), 5_000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket connect error')); }, { once: true });
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer); pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error))); else entry.resolve(message.result);
    } else for (const listener of listeners.get(message.method) ?? []) listener(message.params);
  });
  socket.addEventListener('close', () => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Debugger closed')); }
    pending.clear();
  });
  const connection = {
    send(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, 12_000);
        pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
      });
    },
    async evaluate(expression, extra = {}) {
      const result = await this.send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true,
        allowUnsafeEvalBlockedByCSP: false, ...extra,
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    },
    on(method, listener) { listeners.set(method, [...(listeners.get(method) ?? []), listener]); },
    close() { socket.close(); },
  };
  connections.push(connection); return connection;
}
async function probe(name, action) {
  if (only && !only.test(name)) return;
  currentAction = name;
  const accepted = ACCEPTED_RISKS.get(name);
  try {
    const detail = await action();
    if (accepted) {
      results.push({ name, status: 'FAIL', evidence: 'accepted risk no longer reproduces: remove it from ACCEPTED_RISKS' });
      console.log(`FAIL ${name}: accepted risk no longer reproduces; remove it from ACCEPTED_RISKS`);
      return;
    }
    results.push({ name, status: 'PASS', detail });
    console.log(`PASS ${name}`);
  } catch (error) {
    const status = accepted && error.code === 'ERR_ASSERTION' ? 'ACCEPTED' : 'FAIL';
    results.push({ name, status, evidence: error.message, ...(accepted ? { accepted } : {}) });
    // Exactly one line per probe.
    console.log(`${status === 'ACCEPTED' ? 'ACCEPTED-RISK' : 'FAIL'} ${name}: ${String(error.message).replace(/\s*\n\s*/g, ' ')}`);
  }
}
function launch(extra, profile, moreEnv = {}) {
  const logs = [];
  const item = spawn(process.execPath, [path.join(root, 'scripts/run-electron.mjs'), '.', `--user-data-dir=${profile}`, ...extra], {
    cwd: appRoot, detached: true,
    env: { ...process.env, GEORAMA_E2E: '1', GEORAMA_DEVTOOLS: '0', ...moreEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [item.stdout, item.stderr]) stream.on('data', data => logs.push(String(data)));
  item.logs = logs; children.add(item); return item;
}
async function stop(item) {
  if (!item?.pid) return;
  const exited = new Promise(resolve => {
    if (item.exitCode !== null || item.signalCode !== null) resolve(); else item.once('exit', resolve);
  });
  const signal = (group, sig) => { try { process.kill(group ? -item.pid : item.pid, sig); } catch (e) { if (e.code !== 'ESRCH') throw e; } };
  signal(false, 'SIGTERM');
  const timer = setTimeout(() => signal(true, 'SIGKILL'), 3_000);
  try { await exited; } finally { clearTimeout(timer); signal(true, 'SIGKILL'); }
  children.delete(item);
}
async function ownedSockets(item) {
  const { stdout: processes } = await run('ps', ['-eo', 'pid=,ppid=,pgid=,args=']);
  const owned = processes.trim().split('\n').map(line => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean)
    .filter(match => Number(match[3]) === item.pid).map(match => ({ pid: Number(match[1]), ppid: Number(match[2]), args: match[4] }));
  const { stdout } = await run('ss', ['-ltnup']);
  const sockets = stdout.split('\n').filter(line => owned.some(({ pid }) => line.includes(`pid=${pid},`)));
  return { owned, sockets };
}
async function call(name, ...args) {
  return page.evaluate(`window.__boundary[${JSON.stringify(name)}](...${JSON.stringify(args)})`);
}
async function ready() {
  const end = Date.now() + 8_000;
  while (Date.now() < end) {
    try { if (await page.evaluate('!!window.__boundary && document.readyState === "complete"')) return; } catch { /* new context */ }
    await delay(75);
  }
  throw new Error('Same-origin probe script not ready');
}

// Serialized into an external .js file; this is NOT executed by Runtime.evaluate.
function attacker(config) {
  'use strict';
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const violations = [];
  document.addEventListener('securitypolicyviolation', e => violations.push({ directive: e.effectiveDirective, blocked: e.blockedURI }));
  const asError = e => String(e?.name || '') + ': ' + String(e?.message || e);
  const bounded = (promise, ms = 500) => Promise.race([promise, wait(ms).then(() => ({ timeout: true }))]);
  const attempt = async fn => { try { return await bounded(Promise.resolve().then(fn)); } catch (e) { return { error: asError(e) }; } };
  const elements = [], urls = [], dragEvents = [];
  for (const type of ['dragenter','dragover','drop']) document.addEventListener(type,e=>{
    dragEvents.push({type:e.type,trusted:e.isTrusted,types:[...e.dataTransfer.types]});
    // A real editor accepts drops; permit dragover, not the drop's default navigation.
    if (type === 'dragenter' || type === 'dragover') e.preventDefault();
  });
  const add = (tag, attrs) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    document.body.append(node); elements.push(node); return node;
  };
  const makeBlob = (text, type = 'text/javascript') => { const url = URL.createObjectURL(new Blob([text], { type })); urls.push(url); return url; };
  const endpoint = (kind, closed = false, host = false) => `${host ? config.hostnameBase : closed ? config.closedBase : config.base}/${kind}`;
  window.__boundary = {
    async privilege() {
      const api = window.georama;
      const before = await api.getAppInfo();
      const originalFunction = api.getAppInfo;
      const tamper = {};
      for (const [name, fn] of Object.entries({
        assignment: () => { api.getAppInfo = () => ({ pwn: true }); },
        extension: () => { api.invoke = () => {}; },
        replacement: () => { window.georama = { invoke: () => {} }; },
        objectPrototype: () => Object.setPrototypeOf(api, { invoke: () => {} }),
      })) { try { fn(); tamper[name] = 'allowed'; } catch (e) { tamper[name] = asError(e); } }
      // Function and Object prototypes belong to the unprivileged world only.
      const functionProto = Object.getPrototypeOf(originalFunction);
      const previous = functionProto.__boundaryMarker;
      functionProto.__boundaryMarker = 'page-only';
      let constructorDenied = false;
      // Constant payload only: intentional CSP/bridge-constructor negative test.
      try { originalFunction.constructor('return typeof process')(); } catch { constructorDenied = true; }
      Object.prototype.__boundaryPolluted = true;
      const after = await originalFunction.call({ channel: 'arbitrary:channel' }, 'arbitrary:channel', { path: '/' });
      delete Object.prototype.__boundaryPolluted;
      if (previous === undefined) delete functionProto.__boundaryMarker; else functionProto.__boundaryMarker = previous;
      return {
        globals: ['require', 'process', 'module', 'Buffer', 'global', 'ipcRenderer', 'contextBridge', 'electron'].map(k => [k, typeof window[k]]),
        own: Reflect.ownKeys(api).map(String), frozen: Object.isFrozen(api), functionFrozen:Object.isFrozen(originalFunction),
        descriptor: (() => { const d = Object.getOwnPropertyDescriptor(window, 'georama'); return { writable: d.writable, configurable: d.configurable }; })(),
        tamper, constructorDenied, same: JSON.stringify(before) === JSON.stringify(after), before, after,
        suspiciousOwnGlobals: Object.getOwnPropertyNames(window).filter(k => /electron|ipc|bridge|require|node|process/i.test(k)),
      };
    },
    async csp() {
      const start = violations.length;
      let evalError;
      // Constant payload only; no untrusted string reaches Function.
      try { new Function('return 1')(); } catch (e) { evalError = asError(e); }
      add('script', {}).textContent = '';
      const script = document.createElement('script'); script.textContent = 'window.__boundaryInline=1'; document.body.append(script); elements.push(script);
      await wait(60);
      const response = await fetch('/index.html');
      return { evalError, inline: typeof window.__boundaryInline, violations: violations.slice(start), headers: Object.fromEntries(response.headers), status: response.status };
    },
    async resources(closed = false) {
      const start = violations.length;
      const outcomes = {};
      const p = kind => endpoint(kind, closed);
      await Promise.all([
        attempt(() => fetch(p('fetch'), { signal: AbortSignal.timeout(300) })).then(x => outcomes.fetch = x?.error || x?.status || x),
        attempt(() => new Promise(resolve => { const x = new XMLHttpRequest(); x.open('GET', p('xhr')); x.timeout = 300; x.onload = () => resolve(x.status); x.onerror = () => resolve('error'); x.ontimeout = () => resolve('timeout'); x.send(); })).then(x => outcomes.xhr = x),
        attempt(() => navigator.sendBeacon(p('beacon'), 'test')).then(x => outcomes.beacon = x),
        attempt(() => { const es = new EventSource(p('eventsource')); setTimeout(() => es.close(), 200); return 'constructed'; }).then(x => outcomes.eventsource = x),
        attempt(() => { const ws = new WebSocket(p('websocket').replace('http:', 'ws:')); setTimeout(() => { try { ws.close(); } catch {} }, 250); return 'constructed'; }).then(x => outcomes.websocket = x),
        attempt(() => import(p('import'))).then(x => outcomes.import = x),
      ]);
      for (const [tag, attrs] of [
        ['img', { src: p('img') }], ['script', { src: p('script') }],
        ['link', { rel: 'stylesheet', href: p('stylesheet') }],
        ['video', { src: p('video'), preload: 'auto', autoplay: '' }], ['audio', { src: p('audio'), preload: 'auto', autoplay: '' }],
        ['object', { data: p('object') }], ['embed', { src: p('embed') }],
        ['link', { rel: 'prefetch', href: p('prefetch') }], ['link', { rel: 'preload', as: 'script', href: p('preload') }],
      ]) add(tag, attrs);
      // External SELF CSS carries the network-bearing url(), @import and font-face.
      const css = add('link', { rel: 'stylesheet', href: '/assets/__boundary/' + (closed ? 'closed.css' : 'network.css') });
      const sample = add('div', { class: 'boundary-css-test' + (closed ? 'Closed' : '') }); sample.textContent = 'force font and background';
      await bounded(new Promise(resolve=>{
        if(css.sheet)resolve(); else {css.onload=()=>resolve();css.onerror=()=>resolve();}
      }),1000);
      outcomes.fontLoad=await attempt(()=>document.fonts.load('16px '+(closed?'BoundaryTestClosed':'BoundaryTest')));
      await wait(250);
      return { outcomes, cssLoaded: !!css.sheet, violations: violations.slice(start), href: location.href };
    },
    async hints() {
      const start = violations.length;
      for (const host of [false, true]) {
        add('link', { rel: 'preconnect', href: endpoint('preconnect', false, host), crossorigin: 'anonymous' });
        add('link', { rel: 'dns-prefetch', href: endpoint('dns-prefetch', false, host) });
      }
      await wait(1000);
      return { violations: violations.slice(start), host: config.hostnameBase };
    },
    async indirections() {
      const start = violations.length;
      const outcomes = {};
      const blobScript = makeBlob(`fetch(${JSON.stringify(config.base + '/blob-script')})`);
      add('script', { src: blobScript });
      add('script', { src: 'data:text/javascript,window.__boundaryDataScript=1' });
      const dataImage=add('img', { src: 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><image width="1" height="1" href="${config.base}/svg-img"/></svg>`) });
      const svg = makeBlob(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><image width="1" height="1" href="${config.base}/blob-svg"/></svg>`, 'image/svg+xml');
      const blobImage=add('img', { src: svg });
      outcomes.dataImage=await attempt(()=>dataImage.decode().then(()=>true));
      outcomes.blobImage=await attempt(()=>blobImage.decode().then(()=>true));
      outcomes.blobImport = await attempt(() => import(blobScript));
      outcomes.dataImport = await attempt(() => import('data:text/javascript,export default 1'));
      outcomes.dataWorker = await attempt(() => { const w = new Worker('data:text/javascript,postMessage(1)'); setTimeout(() => w.terminate(), 200); return 'constructed'; });
      await wait(250);
      return { outcomes, violations: violations.slice(start), dataScriptExecuted: !!window.__boundaryDataScript };
    },
    async worker(kind, blob = false, hostname = false) {
      const start = violations.length;
      const url = blob ? makeBlob(config.workerSource) : '/assets/__boundary/worker.js';
      const shared = kind === 'SharedWorker';
      let worker;
      try {
        worker = shared ? new SharedWorker(url, 'boundary-' + Math.random()) : new Worker(url);
        const port = shared ? worker.port : worker;
        const result = await bounded(new Promise(resolve => {
          port.onmessage = e => resolve(e.data);
          worker.onerror = e => { e.preventDefault(); resolve({ error: String(e.message) }); };
          if (shared) port.start();
          port.postMessage({ base: hostname ? config.hostnameBase : config.base, type: kind + (blob ? '-blob' : '-self') + (hostname ? '-hostname' : '') });
        }), 2000);
        if (shared) { port.postMessage({ stop: true }); port.close(); } else worker.terminate();
        await wait(100);
        return { result, violations: violations.slice(start) };
      } catch (e) { return { error: asError(e), violations: violations.slice(start) }; }
    },
    async serviceWorker() {
      return { available: !!navigator.serviceWorker, registration: await attempt(() => navigator.serviceWorker.register('/assets/__boundary/service-worker.js')) };
    },
    async rtc(hostname = false, tcp = false, closed = false) {
      const start = violations.length;
      let pc;
      try {
        // Relay-only avoids advertising local host candidates/mDNS. Target ONLY our UDP socket.
        pc = new RTCPeerConnection({ iceServers: [tcp ? {urls:'turn:127.0.0.1:'+(closed ? config.closedTCPPort : config.httpPort)+'?transport=tcp',username:'boundary',credential:'fixture-only'} : { urls: 'stun:' + (hostname ? 'hints.boundary.invalid' : '127.0.0.1') + ':' + (closed ? config.closedUDPPort : config.udpPort) }], iceTransportPolicy: 'relay' });
        const candidates = [], errors=[];
        pc.onicecandidateerror = e => errors.push({url:e.url,code:e.errorCode,text:e.errorText});
        pc.onicecandidate = e => { if (e.candidate) candidates.push(e.candidate.candidate); };
        pc.createDataChannel('boundary');
        await pc.setLocalDescription(await pc.createOffer());
        await wait(1000);
        return { state: pc.iceGatheringState, candidates, errors, violations: violations.slice(start) };
      } catch (e) { return { error: asError(e), violations: violations.slice(start) }; }
      finally { pc?.close(); }
    },
    async permissions() {
      const states = {};
      for (const name of ['geolocation', 'notifications', 'camera', 'microphone', 'midi', 'clipboard-read', 'clipboard-write', 'background-sync', 'accelerometer', 'gyroscope', 'magnetometer', 'display-capture', 'persistent-storage', 'window-management']) {
        states[name] = await attempt(() => navigator.permissions.query({ name }).then(p => p.state));
      }
      const requests = {};
      requests.geolocation = await attempt(() => new Promise(resolve => navigator.geolocation.getCurrentPosition(() => resolve('ALLOWED'), e => resolve({ code: e.code, message: e.message }), { timeout: 300 })));
      requests.notifications = await attempt(() => Notification.requestPermission());
      requests.camera = await attempt(() => navigator.mediaDevices.getUserMedia({ video: true }).then(s => { s.getTracks().forEach(t => t.stop()); return 'ALLOWED'; }));
      requests.microphone = await attempt(() => navigator.mediaDevices.getUserMedia({ audio: true }).then(s => { s.getTracks().forEach(t => t.stop()); return 'ALLOWED'; }));
      requests.midi = await attempt(() => navigator.requestMIDIAccess({ sysex: true }).then(() => 'ALLOWED'));
      requests.clipboard = await attempt(() => navigator.clipboard.readText().then(() => 'ALLOWED'));
      return { states, requests };
    },
    async protocol(url, options) {
      try { const r = await fetch(url, { ...options, signal: AbortSignal.timeout(1800) }); return { status: r.status, responseURL:r.url, headers: Object.fromEntries(r.headers), body: (await r.text()).slice(0, 700), length: +(r.headers.get('content-length') || 0) }; }
      catch (e) { return { error: asError(e) }; }
    },
    async burst() {
      const output = [];
      for (let batch = 0; batch < 12; batch++) {
        output.push(...await Promise.all(Array.from({ length: 8 }, (_, i) => fetch('/index.html?boundary=' + (batch * 8 + i), { signal: AbortSignal.timeout(1500) }).then(r => ({ status: r.status })).catch(e => ({ error: asError(e) })))));
      }
      return output;
    },
    frame(kind) {
      const makers = {
        app: () => add('iframe', { src: 'georama://app/index.html' }),
        http: () => add('iframe', { src: config.base + '/iframe' }),
        about: () => add('iframe', { src: 'about:blank' }),
        data: () => add('iframe', { src: 'data:text/html,frame' }),
        blob: () => add('iframe', { src: makeBlob('<p>frame</p>', 'text/html') }),
        srcdoc: () => add('iframe', { srcdoc: '<!doctype html><script src="georama://app/assets/__boundary/srcdoc.js"></script>' }),
        webview: () => add('webview', { src: config.base + '/webview' }),
      };
      makers[kind]();
      return { elements: document.querySelectorAll('iframe,webview').length, webviewAPI: typeof document.querySelector('webview')?.getWebContentsId };
    },
    async externalWorkers(closed = false) {
      const start = violations.length;
      const out = {};
      for (const kind of ['Worker','SharedWorker']) out[kind] = await attempt(() => new Promise(resolve => {
        try {
          const w = new window[kind](endpoint('external-' + kind, closed));
          w.onerror = e => { e.preventDefault(); resolve({error:String(e.message)}); };
          setTimeout(() => { if (kind === 'Worker') w.terminate(); else w.port.close(); resolve({noMessage:true}); }, 250);
        } catch(e) { resolve({error:asError(e)}); }
      }));
      out.ServiceWorker = await attempt(() => navigator.serviceWorker.register(endpoint('external-service-worker', closed)));
      return {out,violations:violations.slice(start)};
    },
    cleanFrames() { for (const f of document.querySelectorAll('iframe,webview')) f.remove(); },
    popup(url) { return window.open(url) === null; },
    navigate(kind, url) {
      if (kind === 'assign') location.assign(url);
      if (kind === 'replace') location.replace(url);
      if (kind === 'anchor' || kind === 'target-self' || kind === 'target-blank' || kind === 'target-named') {
        const a = add('a', { href: url, target: kind === 'target-blank' ? '_blank' : kind === 'target-named' ? 'boundary' : '_self' }); a.click();
      }
      if (kind === 'form') { const f = add('form', { action: url, method: 'POST' }); f.submit(); }
      if (kind === 'meta') add('meta', { 'http-equiv': 'refresh', content: '0;url=' + url });
      if (kind === 'drop-url' || kind === 'drop-file') {
        const dt = new DataTransfer();
        if (kind === 'drop-url') { dt.setData('text/uri-list', url); dt.setData('text/plain', url); }
        else dt.items.add(new File(['harmless fixture'], 'boundary.txt', { type: 'text/plain' }));
        for (const type of ['dragenter', 'dragover', 'drop']) document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      }
      return true;
    },
    blobDocument() { return makeBlob('<!doctype html><p>blob document</p>', 'text/html'); },
    snapshot() { return { href: location.href, jsExecuted: !!window.__boundaryJSURL, violations: [...violations], dragEvents: [...dragEvents] }; },
  };
}

async function cleanup() {
  cleanupPromise ??= (async () => {
    for (const c of connections) c.close();
    await Promise.all([...children].map(stop));
    for (const close of servers) await close();
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  })();
  return cleanupPromise;
}
for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  process.once(signal, () => { void cleanup().finally(() => process.exit(exitCode)); });
}

try {
  observedCommit = await run('git', ['rev-parse', 'HEAD'], { cwd: root }).then(result => result.stdout.trim(), () => 'not a git checkout');
  temporaryDirectory = await mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'georama-boundary-'));
  assert.ok(temporaryDirectory.startsWith(path.resolve(process.env.TMPDIR || os.tmpdir()) + path.sep));
  appRoot = path.join(temporaryDirectory, 'app');
  await mkdir(appRoot);
  for (const item of ['package.json', 'dist-electron', 'dist/renderer']) {
    await cp(path.join(root, item), path.join(appRoot, item), { recursive: true });
  }
  rendererRoot = path.join(appRoot, 'dist/renderer');
  assets = path.join(rendererRoot, 'assets/__boundary');
  indexPath = path.join(rendererRoot, 'index.html');
  originalIndex = await readFile(indexPath, 'utf8');
  await mkdir(assets, { recursive: true });
  const sentinel = 'BOUNDARY_OUTSIDE_RENDERER_SENTINEL';
  const sentinelFile = path.join(temporaryDirectory, 'outside.txt');
  await writeFile(sentinelFile, sentinel);
  await symlink(sentinelFile, path.join(rendererRoot, '__boundary-link'));
  await writeFile(path.join(rendererRoot, '__boundary-unicode-é.txt'), 'composed');
  await writeFile(path.join(rendererRoot, '__boundary-unicode-é.txt'), 'decomposed');
  const httpServer = http.createServer((req, res) => {
    evidence.http.push({ action: currentAction, url: req.url, method: req.method });
    req.resume();
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': req.url?.includes('import') ? 'text/javascript' : 'text/plain', 'Connection': 'close' });
    res.end(req.url?.includes('import') ? 'export default 1' : 'loopback fixture');
  });
  httpServer.on('connection', socket => evidence.tcp.push({ action: currentAction, remote: socket.remoteAddress }));
  httpServer.on('upgrade', (req, socket) => { evidence.http.push({ action: currentAction, url: req.url, method: 'UPGRADE' }); socket.destroy(); });
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  servers.push(() => new Promise(resolve => { httpServer.closeAllConnections(); httpServer.close(resolve); }));
  const udp = dgram.createSocket('udp4');
  udp.on('message', (packet, remote) => evidence.udp.push({ action: currentAction, size: packet.length, header: packet.subarray(0, 8).toString('hex'), remote: remote.address }));
  await new Promise(resolve => udp.bind(0, '127.0.0.1', resolve));
  servers.push(() => new Promise(resolve => udp.close(resolve)));
  const base = `http://127.0.0.1:${httpServer.address().port}`;
  const closedPort = await freePort();
  const closedUDP=dgram.createSocket('udp4');
  await new Promise(resolve=>closedUDP.bind(0,'127.0.0.1',resolve));
  const closedUDPPort=closedUDP.address().port;
  await new Promise(resolve=>closedUDP.close(resolve));
  const closedBase = `http://127.0.0.1:${closedPort}`;
  const hostnameBase = `http://hints.boundary.invalid:${httpServer.address().port}`;
  // NetLog plus a wildcard map ensure no test hostname is sent to an external DNS resolver.
  const workerSource = `
const shared = typeof onconnect !== 'undefined';
async function run(port, data) {
  if (data.stop) { close(); return; }
  const violations = [];
  addEventListener('securitypolicyviolation', e => violations.push(e.effectiveDirective));
  let network;
  try { const r = await fetch(data.base + '/worker-' + data.type, { mode: 'no-cors', signal: AbortSignal.timeout(700) }); network = { allowed: true, type: r.type }; }
  catch (e) { network = { allowed: false, error: String(e) }; }
  port.postMessage({ globals: [typeof require, typeof process, typeof module], network, violations });
}
if (shared) onconnect = e => { const p=e.ports[0]; p.onmessage=e=>run(p,e.data); p.start(); };
else onmessage = e => run(self,e.data);
`;
  const config = { base, closedBase, hostnameBase, udpPort: udp.address().port, closedUDPPort, closedTCPPort:closedPort, httpPort:httpServer.address().port, workerSource };
  await writeFile(path.join(assets, 'probe.js'), `(${attacker.toString()})(${JSON.stringify(config)});\n`);
  await writeFile(path.join(assets, 'worker.js'), workerSource);
  await writeFile(path.join(assets, 'srcdoc.js'), 'window.__boundarySrcdoc=true;');
  await writeFile(path.join(assets, 'service-worker.js'), 'self.addEventListener("install",()=>self.skipWaiting());');
  for (const [name, address] of [['network.css', base], ['closed.css', closedBase]]) {
    await writeFile(path.join(assets, name), `@import url('${address}/css-import');\n@font-face{font-family:BoundaryTest${name === 'closed.css' ? 'Closed' : ''};src:url('${address}/css-font')}\n.boundary-css-test${name === 'closed.css' ? 'Closed' : ''}{font-family:BoundaryTest${name === 'closed.css' ? 'Closed' : ''};background-image:url('${address}/css-url');width:100px;height:30px}\n`);
  }
  const modifiedIndex = originalIndex.replace('</head>', '<script defer src="/assets/__boundary/probe.js"></script></head>');
  await writeFile(indexPath, modifiedIndex);
  await writeFile(path.join(rendererRoot, '__boundary-other.html'), modifiedIndex);

  await probe('launcher forwards argv and Wayland env without shell evaluation', async()=>{
    // Run an exact launcher copy with a harmless stand-in binary; never a second app.
    const fixture=path.join(temporaryDirectory,'launcher-fixture');
    const moduleDir=path.join(fixture,'node_modules/electron'); await mkdir(moduleDir,{recursive:true});
    // The launcher and every helper module next to it (the display resolver arrives with another change).
    for (const name of ['run-electron.mjs', 'display-env.mjs']) {
      try { await writeFile(path.join(fixture, name), await readFile(path.join(root, 'scripts', name), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT' || name === 'run-electron.mjs') throw error; }
    }
    const output=path.join(fixture,'observed.json'), marker=path.join(fixture,'INJECTION');
    const fake=path.join(fixture,'fake-electron');
    await writeFile(fake,`#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(output)},JSON.stringify({argv:process.argv.slice(2),wayland:process.env.WAYLAND_DISPLAY,runtime:process.env.XDG_RUNTIME_DIR}));\n`,{mode:0o700});
    await writeFile(path.join(moduleDir,'package.json'),JSON.stringify({main:'index.cjs'}));
    await writeFile(path.join(moduleDir,'index.cjs'),'module.exports='+JSON.stringify(fake)+';\n');
    const argv=['.','literal space;$(touch '+marker+')','${HOME}','"quoted"'];
    const wayland='wayland-0;$(touch '+marker+')';
    const runtime=path.join(fixture,'runtime space;$(touch '+marker+')');
    await run(process.execPath,[path.join(fixture,'run-electron.mjs'),...argv],{cwd:fixture,env:{...process.env,WAYLAND_DISPLAY:wayland,XDG_RUNTIME_DIR:runtime},timeout:5000});
    const observed=JSON.parse(await readFile(output,'utf8'));
    assert.deepEqual(observed,{argv,wayland,runtime});
    await assert.rejects(readFile(marker),{code:'ENOENT'});
    return observed;
  });
  await probe('normal hidden launch has no network listeners', async () => {
    const profile = path.join(temporaryDirectory, 'normal'); await mkdir(profile);
    const normal = launch([], profile);
    await delay(1800);
    assert.equal(normal.exitCode, null, normal.logs.join(''));
    const snapshot = await ownedSockets(normal);
    evidence.normalSockets = snapshot;
    assert.ok(snapshot.owned.some(p => p.args.includes('--type=renderer')), 'renderer running');
    assert.deepEqual(snapshot.sockets, []);
    assert.ok(!normal.logs.join('').includes('DevTools listening'));
    await stop(normal);
    return snapshot;
  });
  const literal = '--boundary-literal=$(touch ' + path.join(temporaryDirectory, 'SHOULD_NOT_EXIST') + '); space;${HOME}';
  /** Start a hidden app with loopback-only inspectors and attach to its first page and to the main process. */
  async function startApp(name) {
    const firstConnection = connections.length;
    const profile = path.join(temporaryDirectory, 'profile-' + name); await mkdir(profile);
    const netlog = path.join(temporaryDirectory, `netlog-${name}.json`); netlogs.push(netlog);
    rendererPort = await freePort();
    do { mainPort = await freePort(); } while (mainPort === rendererPort);
    child = launch([
      `--remote-debugging-port=${rendererPort}`, '--remote-debugging-address=127.0.0.1',
      `--remote-allow-origins=http://127.0.0.1:${rendererPort}`, `--inspect=127.0.0.1:${mainPort}`,
      // A stand-in for "DNS answers 127.0.0.1": the app's own catch-all rule must still keep names unreachable.
      '--host-resolver-rules=MAP *.boundary.invalid 127.0.0.1', `--log-net-log=${netlog}`, literal,
    ], profile);
    page = await connect((await targetAt(rendererPort, t => t.type === 'page' && t.url.startsWith('georama://app/'))).webSocketDebuggerUrl);
    main = await connect((await targetAt(mainPort, t => t.type === 'node')).webSocketDebuggerUrl);
    await page.send('Runtime.enable'); await page.send('Page.enable'); await ready();
    await main.evaluate(`globalThis.__boundaryElectron = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron'); true`);
    return { child, profile, netlog, rendererPort, mainPort, firstConnection };
  }
  /** Detach every inspector client first: Node waits for them, and NetLog is only finalized on a clean exit. */
  async function stopApp(app) {
    for (const connection of connections.slice(app.firstConnection)) connection.close();
    await stop(app.child);
  }
  async function pageTargets() {
    const response = await fetch(`http://127.0.0.1:${rendererPort}/json/list`, { signal: AbortSignal.timeout(2000) });
    return (await response.json()).filter(target => target.type === 'page');
  }
  const guardLines = () => child.logs.join('').split('\n').filter(line => line.startsWith('navigation guard:'));
  /** The guard must discard the offending window and open a fresh editor: observe it, then re-attach. */
  async function expectRecovery(label, action) {
    const before = await pageTargets();
    assert.equal(before.length, 1, `${label}: exactly one page before: ${JSON.stringify(before.map(target => target.url))}`);
    const oldId = before[0].id, guardBefore = guardLines().length;
    try { await action(); } catch { /* the page is destroyed under the call */ }
    let after = [];
    for (const deadline = Date.now() + 10_000; ; await delay(100)) {
      after = await pageTargets().catch(() => []);
      if (!after.some(target => target.id === oldId) && after.some(target => target.url === editorUrl) && guardLines().length > guardBefore) break;
      assert.ok(Date.now() < deadline, `${label}: no recovery; targets ${JSON.stringify(after.map(target => target.url))}; guard ${JSON.stringify(guardLines().slice(guardBefore))}`);
    }
    const fresh = after.find(target => target.url === editorUrl);
    page = await connect(fresh.webSocketDebuggerUrl);
    await page.send('Runtime.enable'); await page.send('Page.enable'); await ready();
    const windows = await main.evaluate('__boundaryElectron.BrowserWindow.getAllWindows().length');
    return { oldTargetGone: true, newTarget: fresh.url, windows, guard: guardLines().slice(guardBefore) };
  }
  /** Run work against a brand-new app (the guard quits after 3 recoveries in 60 s), then stop it. */
  async function useFreshApp(name, work) {
    const saved = { child, page, main, rendererPort, mainPort };
    const app = await startApp(name);
    try { return await work(app); }
    finally {
      await stopApp(app);
      ({ child, page, main, rendererPort, mainPort } = saved);
    }
  }

  await probe('positive control: the fixture listeners count traffic that really arrives', async () => {
    const response = await fetch(base + '/control'); await response.text();
    const sender = dgram.createSocket('udp4');
    await new Promise(resolve => sender.send(Buffer.from('ping'), udp.address().port, '127.0.0.1', resolve));
    sender.close(); await delay(200);
    assert.equal(evidence.http.length, 1, 'http listener counts a request'); assert.ok(evidence.tcp.length >= 1, 'tcp listener counts a connection'); assert.equal(evidence.udp.length, 1, 'udp listener counts a datagram');
    evidence.http.length = 0; evidence.tcp.length = 0; evidence.udp.length = 0;
  });
  const primary = await startApp('primary');
  const profile = primary.profile;
  const runtime = await main.evaluate(`(() => { const { app, BrowserWindow } = __boundaryElectron; const w = BrowserWindow.getAllWindows()[0]; const c = w.webContents; return { visible:w.isVisible(), preferences:c.getLastWebPreferences(), userData:app.getPath('userData'), argv:process.argv, spellcheck:c.session.isSpellCheckerEnabled(), throttling:c.getBackgroundThrottling() }; })()`);
  evidence.observations.runtime = runtime;
  await probe('runtime isolation and exact profile', async () => {
    assert.equal(runtime.visible, false); assert.equal(runtime.userData, profile);
    for (const [key, value] of Object.entries({ contextIsolation:true, sandbox:true, nodeIntegration:false, nodeIntegrationInWorker:false, nodeIntegrationInSubFrames:false, webSecurity:true, allowRunningInsecureContent:false, webviewTag:false })) assert.equal(runtime.preferences[key], value, key);
    assert.equal(runtime.spellcheck, false); assert.equal(runtime.throttling, false);
    return runtime;
  });
  await probe('explicit inspectors bind only loopback; argv is literal', async () => {
    const snapshot = await ownedSockets(child); evidence.debugSockets = snapshot;
    assert.equal(snapshot.sockets.length, 2);
    for (const line of snapshot.sockets) assert.match(line, /127\.0\.0\.1:/);
    assert.ok(runtime.argv.includes(literal));
    await assert.rejects(readFile(path.join(temporaryDirectory, 'SHOULD_NOT_EXIST')), { code: 'ENOENT' });
    return snapshot;
  });
  await probe('page privilege and bridge tampering', async () => {
    const out = await call('privilege'); evidence.observations.privilege = out;
    for (const [key, value] of out.globals) assert.equal(value, 'undefined', key);
    assert.deepEqual(out.own, ['getAppInfo']); assert.equal(out.frozen, true); assert.equal(out.functionFrozen,true); assert.equal(out.same, true);
    assert.deepEqual(out.descriptor, { writable:false, configurable:false });
    for (const outcome of Object.values(out.tamper)) assert.notEqual(outcome, 'allowed');
    assert.equal(out.constructorDenied, true);
    assert.deepEqual(Object.keys(out.before).sort(), ['name','id','version','electron','chrome','node','platform','e2e'].sort());
    assert.equal(out.before.electron, '44.7.0');
    return out;
  });
  await probe('CSP blocks executable inline code and eval', async () => {
    const out = await call('csp'); evidence.observations.csp = out;
    assert.equal(out.status, 200); assert.match(out.evalError, /EvalError/); assert.equal(out.inline, 'undefined');
    assert.ok(out.violations.some(v => v.directive === 'script-src'));
    assert.ok(out.violations.some(v => v.directive === 'script-src-elem'));
    assert.match(out.headers['content-security-policy'], /default-src 'none'/);
    return out;
  });
  for (const closed of [false, true]) await probe(`page fetch XHR beacon EventSource WebSocket resource CSS import channels (${closed ? 'closed port' : 'listener'})`, async () => {
    const before = evidence.tcp.length;
    const out = await call('resources', closed);
    evidence.observations['resources-' + closed] = out;
    assert.equal(evidence.tcp.length, before, 'no TCP connection to fixture');
    for (const directive of ['connect-src','script-src-elem','style-src-elem','img-src','media-src','object-src','font-src']) assert.ok(out.violations.some(v => v.directive === directive), directive);
    assert.equal(out.cssLoaded, true, 'self stylesheet positive control');
    return out;
  });
  await probe('preconnect and dns-prefetch hints produce no fixture connection', async () => {
    const before = evidence.tcp.length;
    const out = await call('hints'); evidence.observations.hints = out;
    assert.equal(evidence.tcp.length, before, 'resource hint created a loopback TCP connection');
    return out;
  });
  await probe('hostname resolver and worker transport isolation', async () => {
    const before = evidence.http.length;
    const out = await call('worker','Worker',false,true); evidence.observations.workerHostname = out;
    assert.deepEqual(out.result?.globals,['undefined','undefined','undefined'],'self-worker positive control');
    assert.equal(evidence.http.length,before,'hostname resolved through test loopback map and worker emitted HTTP: '+JSON.stringify(evidence.http.slice(before)));
    // External DNS packets are deliberately not tested; the host map keeps this local.
    return out;
  });
  await probe('blob data SVG and dynamic-import indirections', async () => {
    const before = evidence.tcp.length;
    const out = await call('indirections'); evidence.observations.indirections = out;
    assert.equal(evidence.tcp.length, before); assert.equal(out.dataScriptExecuted, false);
    assert.ok(out.outcomes.blobImport.error); assert.ok(out.outcomes.dataImport.error);
    assert.equal(out.outcomes.dataImage,true,'data SVG must actually decode');
    assert.equal(out.outcomes.blobImage,true,'blob SVG must actually decode');
    assert.ok(out.violations.some(v=>v.directive==='worker-src'&&v.blocked==='data'),'data worker blocked by real CSP');
    return out;
  });
  for (const closed of [false,true]) await probe('external Worker SharedWorker ServiceWorker scripts ('+(closed?'closed port':'listener')+')', async()=>{
    const before=evidence.tcp.length; const out=await call('externalWorkers',closed);
    assert.equal(evidence.tcp.length,before); evidence.observations['externalWorkers-'+closed]=out;
    return out;
  });
  for (const kind of ['Worker', 'SharedWorker']) {
    for (const blob of [false, true]) await probe(blob ? `blob ${kind} inherits CSP and no Node` : `self ${kind === 'Worker' ? 'dedicated' : 'shared'} worker network policy`, async () => {
      const before = evidence.http.length;
      const out = await call('worker', kind, blob); evidence.observations[kind + '-' + blob] = out;
      assert.deepEqual(out.result?.globals, ['undefined','undefined','undefined'], 'worker executes with no Node positive control');
      assert.equal(out.result?.network?.allowed, false, 'worker issued network fetch: ' + JSON.stringify(evidence.http.slice(before)));
      assert.equal(evidence.http.length, before);
      return out;
    });
  }
  await probe('ServiceWorker registration denied', async () => {
    const out = await call('serviceWorker'); evidence.observations.serviceWorker = out;
    assert.ok(out.available === false || out.registration?.error);
    return out;
  });
  await probe('page WebRTC STUN egress', async () => {
    const before = evidence.udp.length;
    const out = await call('rtc'); evidence.observations.rtc = out;
    assert.equal(evidence.udp.length, before, 'WebRTC emitted UDP to loopback: ' + JSON.stringify(evidence.udp.slice(before)));
    // A hardened transport may allow construction/gathering but emit no packets.
    return out;
  });
  await probe('page WebRTC TURN TCP egress', async()=>{
    const before=evidence.tcp.length;
    const out=await call('rtc',false,true); evidence.observations.rtcTCP=out;
    assert.equal(evidence.tcp.length,before,'WebRTC TURN opened TCP: '+JSON.stringify(evidence.tcp.slice(before)));
    return out;
  });
  await probe('WebRTC closed UDP/TCP ports (observations, not denial proof)',async()=>{
    const out={udp:await call('rtc',false,false,true),tcp:await call('rtc',false,true,true)};
    evidence.observations.rtcClosed=out;
    assert.equal(child.exitCode,null);
    return out;
  });
  await probe('permission queries and real requests denied', async () => {
    const out = await call('permissions'); evidence.observations.permissions = out;
    for (const [name, state] of Object.entries(out.states)) assert.ok(state === 'denied' || state.error, name + ': ' + JSON.stringify(state));
    for (const [name, value] of Object.entries(out.requests)) {
      assert.notEqual(value, 'ALLOWED', name); assert.ok(!value?.timeout, name + ' unresolved');
    }
    return out;
  });
  await probe('webview tag is inert in a page with webviewTag disabled', async () => {
    const http = evidence.http.length, tcp = evidence.tcp.length;
    const out = await call('frame', 'webview'); evidence.observations.webview = out;
    await delay(300);
    assert.equal(out.webviewAPI, 'undefined', 'a disabled <webview> is an unknown element with no guest API');
    assert.equal(await page.evaluate('location.href'), editorUrl);
    assert.equal(evidence.http.length, http); assert.equal(evidence.tcp.length, tcp);
    await call('cleanFrames'); return out;
  });
  // Main inspector invokes the actual registered handler with real frame references.
  // This is a defense-in-depth test, not a claimed page-accessible ipcRenderer.
  await probe('IPC actual handler rejects subframes and untrusted frame URLs', async () => {
    const out = await main.evaluate(`(async () => {
      const {ipcMain, BrowserWindow} = __boundaryElectron;
      const c = BrowserWindow.getAllWindows()[0].webContents;
      const handler = ipcMain._invokeHandlers.get('app:get-info');
      const out=[];
      for (const f of c.mainFrame.frames) {
        try { await handler({sender:c,senderFrame:f}); out.push({url:f.url,allowed:true}); }
        catch(e) { out.push({url:f.url,error:String(e)}); }
      }
      for (const url of ['about:blank','blob:georama://app/fixture','data:text/html,x','https://127.0.0.1/','georama://app@other/']) {
        const f = {url};
        try { await handler({sender:{mainFrame:f},senderFrame:f}); out.push({url,allowed:true}); }
        catch(e) { out.push({url,error:String(e)}); }
      }
      try {await handler({sender:c,senderFrame:null});out.push({missing:true,allowed:true})}catch(e){out.push({missing:true,error:String(e)})}
      try { const ok = await handler({sender:c,senderFrame:c.mainFrame}); out.push({positiveControl:true,id:ok.id}); } catch(e) { out.push({positiveControl:true,error:String(e)}); }
      return out;
    })()`);
    evidence.observations.ipcHandler = out;
    assert.ok(out.length >= 6);
    for (const r of out) assert.equal(r.allowed, undefined, JSON.stringify(r));
    assert.equal(out.find(r => r.positiveControl)?.id, 'georama', 'positive control: the real editor main frame is accepted');
    await call('cleanFrames'); return out;
  });
  const protocolCases = [
    ['/index.html',200], ['/',200], ['georama://app//index.html',200], ['/%2Findex.html',200], ['/%252Findex.html',400], ['/assets/../index.html',200], ['/%69ndex.html',200],
    ['/..%2fpackage.json',400], ['/%2e%2e/package.json',404], ['/assets%2f..%2findex.html',400], ['/%2e%2e%2fpackage.json',400], ['/%252e%252e%252fpackage.json',400],
    ['/%2e%2E%5cpackage.json',400], ['/%5cindex.html',400], ['/%00index.html',400], ['/%E0%A4%A',400],
    ['/index.html.',404], ['/index.html/',200], ['/INDEX.HTML',404],
    ['/__boundary-unicode-%C3%A9.txt',200], ['/__boundary-unicode-e%CC%81.txt',200],
    ['/__boundary-link',403], ['georama://user@app/index.html',200], ['georama://app@other/index.html',null], ['georama://app.evil/index.html',null],
    ['georama://app:123/index.html',200], ['georama://APP/index.html',200],
  ];
  for (const [url, expected] of protocolCases) await probe('protocol ' + url, async () => {
    const out = await call('protocol', url); evidence.observations['protocol ' + url] = out;
    assert.ok(!out.body?.includes(sentinel));
    if(url.includes('user@app')) assert.equal(out.responseURL,'georama://app/index.html','Chromium strips unsupported custom-scheme credentials');
    if (url.includes(':123')) {
      const canonical=await page.evaluate(`new URL(${JSON.stringify(url)}).href`);
      assert.equal(canonical,'georama://app/index.html','Chromium strips unsupported custom-scheme port');
    }
    if (expected === null) assert.ok(out.error || out.status >= 400); else assert.equal(out.status, expected, JSON.stringify(out));
    return out;
  });
  await probe('protocol handler authority checks independent of page CSP',async()=>{
    const out=await main.evaluate(`(async()=>{
      const out=[];
      for(const url of ['georama://app/index.html','georama://other/index.html','georama://app@other/index.html','georama://app.evil/index.html','georama://user@app/index.html']) {
        try {const r=await __boundaryElectron.session.defaultSession.fetch(url);out.push({url,status:r.status,body:(await r.text()).slice(0,80)})}
        catch(e){out.push({url,error:String(e)})}
      }
      return out;
    })()`);
    assert.equal(out[0].status,200,'legitimate protocol control');
    for(const r of out.slice(1)) assert.ok(r.error||r.status>=400,JSON.stringify(r));
    evidence.observations.protocolAuthority=out;return out;
  });
  for (const method of ['HEAD','POST','PUT','DELETE','PATCH','OPTIONS']) await probe('protocol method ' + method, async () => {
    const out = await call('protocol', '/index.html', { method });
    assert.equal(out.status, method === 'HEAD' ? 200 : 405); assert.equal(out.body, '');
    assert.equal(out.headers['x-content-type-options'], 'nosniff'); assert.equal(out.headers['cache-control'], 'no-store');
    return out;
  });
  await probe('protocol Range has no partial-file escape', async () => {
    const out = await call('protocol', '/index.html', { headers: { Range:'bytes=0-9' } });
    assert.equal(out.status, 200); assert.ok(out.body.startsWith('<!doctype html>')); assert.ok(out.body.length > 10);
    return { status:out.status, rangeIgnored:true, headers:out.headers };
  });
  await probe('bounded protocol URL size', async () => {
    const out=[];
    for (const size of [1024, 16384, 65536, 262144]) {
      const start=Date.now(); const response=await call('protocol','/'+'x'.repeat(size));
      out.push({size,status:response.status,error:response.error,ms:Date.now()-start});
    }
    evidence.observations.longURLs=out;
    assert.ok(out.every(x => x.status === 414 || x.error), 'URLs lack an explicit bound: ' + JSON.stringify(out));
    return out;
  });
  await probe('moderate protocol burst remains responsive (96 requests, concurrency 8)', async () => {
    const start=Date.now(); const out=await call('burst');
    assert.equal(out.length,96); assert.ok(out.every(x=>x.status===200),JSON.stringify(out));
    assert.equal((await call('protocol','/index.html')).status,200);
    return {requests:out.length,ms:Date.now()-start};
  });
  const fileURL = new URL('file://' + sentinelFile).href;
  const blobURL = await call('blobDocument');
  const destinations = [
    ['http',base+'/navigate'], ['https',base.replace('http:','https:')+'/navigate'], ['file',fileURL], ['chrome','chrome://version/'],
    ['devtools','devtools://devtools/bundled/inspector.html'], ['view-source','view-source:georama://app/index.html'],
    ['data','data:text/html,boundary'], ['blob',blobURL], ['javascript','javascript:window.__boundaryJSURL=1;void(0)'], ['about','about:blank'],
  ];
  async function restoreApp() {
    if (await page.evaluate('location.href') !== 'georama://app/index.html') {
      await main.evaluate(`__boundaryElectron.BrowserWindow.getAllWindows()[0].loadURL('georama://app/index.html').then(()=>true)`);
      await ready();
    }
  }
  for (const [name,url] of destinations) {
    if (name !== 'about') await probe('navigation assign ' + name, async () => {
      const before=evidence.tcp.length;
      await call('navigate','assign',url); await delay(160);
      const href=await page.evaluate('location.href');
      evidence.observations['navigation-'+name]={href};
      assert.equal(href,'georama://app/index.html','cross-document navigation allowed: '+href);
      assert.equal(evidence.tcp.length,before);
    });
    await restoreApp();
    await probe('popup ' + name, async () => {
      assert.equal(await call('popup',url),true);
      assert.equal(await main.evaluate('__boundaryElectron.BrowserWindow.getAllWindows().length'),1);
    });
  }
  for (const kind of ['anchor','target-self','target-blank','target-named','form','meta','drop-url','drop-file']) {
    await probe('navigation ' + kind, async () => {
      const before=evidence.tcp.length;
      await call('navigate',kind,base+'/navigation-'+kind); await delay(160);
      assert.equal(await page.evaluate('location.href'),'georama://app/index.html'); assert.equal(evidence.tcp.length,before);
    });
    await restoreApp();
  }
  await probe('same-document javascript URL execution', async () => {
    await call('navigate','assign','javascript:window.__boundaryJSURL=1;void(0)'); await delay(100);
    const out=await call('snapshot');
    assert.equal(out.jsExecuted,false,'javascript URL executed despite navigation guard');
    return {href:out.href,jsExecuted:out.jsExecuted,violations:out.violations.filter(v=>v.blocked==='inline')};
  });
  for (const isFile of [false,true]) {
    await probe('native CDP drag-and-drop '+(isFile?'owned file':'loopback URL'), async()=>{
      const before=evidence.tcp.length;
      const beforeDragCount=(await call('snapshot')).dragEvents.length;
      const data={items:isFile?[]:[{mimeType:'text/uri-list',data:base+'/native-drop'}],dragOperationsMask:1,...(isFile?{files:[sentinelFile]}:{})};
      for (const type of ['dragEnter','dragOver','drop']) await page.send('Input.dispatchDragEvent',{type,x:120,y:160,data});
      await delay(200);
      const href=await page.evaluate('location.href'); assert.equal(href,'georama://app/index.html');
      const snapshot=await call('snapshot');
      const trusted=snapshot.dragEvents.slice(beforeDragCount).filter(e=>e.trusted);
      evidence.observations['native-drop-'+isFile]=trusted;
      assert.ok(trusted.some(e=>e.type==='drop'&&e.types.includes(isFile?'Files':'text/uri-list')),'must deliver this trusted drop, not a previous/synthetic one: '+JSON.stringify(trusted));
      assert.equal(evidence.tcp.length,before);
      return trusted;
    });
    await restoreApp();
  }
  const forcedBlob = await call('blobDocument');
  await probe('IPC is refused to every other WebContents, whatever it loads (actual handler through the real preload)', async () => {
    const out = await main.evaluate(`(async () => {
      const { app, BrowserWindow } = __boundaryElectron;
      const path = process.getBuiltinModule('node:path');
      const results = [];
      for (const url of [${JSON.stringify(editorUrl)}, 'georama://app/__boundary-other.html', 'about:blank', ${JSON.stringify(forcedBlob)}, 'data:text/html,<p>boundary</p>']) {
        const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(app.getAppPath(), 'dist-electron', 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
        try {
          await win.loadURL(url);
          const outcome = await win.webContents.executeJavaScript('window.georama ? window.georama.getAppInfo().then(v => ({ value: v.id }), e => ({ error: String(e) })) : ({ noBridge: true })');
          results.push({ url: url.slice(0, 40), ...outcome });
        } catch (e) { results.push({ url: url.slice(0, 40), loadError: String(e) }); }
        win.destroy();
      }
      return results;
    })()`);
    evidence.observations.ipcOtherWebContents = out;
    assert.equal(out.length, 5);
    for (const r of out) assert.equal(r.value, undefined, 'IPC answered a non-editor WebContents: ' + JSON.stringify(r));
    assert.ok(out.some(r => /untrusted sender/.test(r.error ?? '')), 'at least one rejection must come from the handler itself: ' + JSON.stringify(out));
    return out;
  });
  await probe('main stays alive and trusted IPC still works after all probes', async () => {
    assert.equal(child.exitCode,null);
    const info=await page.evaluate('window.georama.getAppInfo()'); assert.equal(info.id,'georama');
    return info;
  });
  await stopApp(primary);

  // ---- one fresh app per violation (3 recoveries per 60 s are allowed, the 4th quits) ------------------------------
  await probe('navigation assign about', () => useFreshApp('about', async () => {
    const http = evidence.http.length, tcp = evidence.tcp.length;
    const info = await expectRecovery('location.assign(about:blank)', () => call('navigate', 'assign', 'about:blank'));
    evidence.observations.recoveryAbout = info;
    assert.equal(info.windows, 1); assert.match(info.guard[0], /recover; main frame committed about:/);
    assert.equal(await page.evaluate('location.href'), editorUrl);
    assert.equal((await page.evaluate('window.georama.getAppInfo()')).id, 'georama', 'the replacement window works');
    assert.equal(evidence.http.length, http); assert.equal(evidence.tcp.length, tcp);
    return info;
  }));
  await probe('cross-document navigation is refused before commit and keeps IPC authority', () => useFreshApp('other-document', async () => {
    const before = await pageTargets();
    assert.equal(before.length, 1, `exactly one page before: ${JSON.stringify(before.map(target => target.url))}`);
    const oldId = before[0].id, guardBefore = guardLines().length;
    await call('navigate', 'assign', 'georama://app/__boundary-other.html').catch(() => {});
    for (const deadline = Date.now() + 10_000; guardLines().length <= guardBefore && Date.now() < deadline;) await delay(100);
    const after = await pageTargets();
    const info = {
      windows: await main.evaluate('__boundaryElectron.BrowserWindow.getAllWindows().length'),
      sameWindow: after.length === 1 && after[0].id === oldId,
      url: after[0]?.url,
      guard: guardLines().slice(guardBefore),
    };
    evidence.observations.refusedOtherDocument = info;
    assert.equal(info.windows, 1, 'no replacement window');
    assert.ok(info.sameWindow, 'the same editor window remains');
    assert.equal(info.url, editorUrl, 'the page never left the editor document');
    assert.equal(info.guard.length, 1, `one guard line: ${JSON.stringify(info.guard)}`);
    assert.match(info.guard[0], /^navigation guard: refuse; main frame before commit georama:$/);
    assert.equal((await page.evaluate('window.georama.getAppInfo()')).id, 'georama');
    return info;
  }));
  for (const kind of ['app', 'http', 'about', 'data', 'blob', 'srcdoc']) {
    await probe(kind === 'srcdoc' ? 'same-origin srcdoc embedding' : `child frame ${kind} is discarded by the navigation guard`, () => useFreshApp('frame-' + kind, async () => {
      const http = evidence.http.length, tcp = evidence.tcp.length;
      const info = await expectRecovery('child frame ' + kind, () => call('frame', kind));
      evidence.observations['recoveryFrame-' + kind] = info;
      assert.equal(info.windows, 1); assert.match(info.guard[0], /recover; child frame committed /);
      assert.equal(await page.evaluate('document.querySelectorAll("iframe,webview").length'), 0, 'the replacement has no frames');
      assert.equal(evidence.http.length, http); assert.equal(evidence.tcp.length, tcp);
      return info;
    }));
  }
  await probe('recovery is rate limited: the fourth violation within 60 s quits the app', () => useFreshApp('ratelimit', async () => {
    const records = [];
    for (let attempt = 1; attempt <= 3; attempt++) records.push(await expectRecovery('violation ' + attempt, () => call('navigate', 'assign', 'about:blank')));
    await call('navigate', 'assign', 'about:blank').catch(() => {});
    for (const deadline = Date.now() + 10_000; guardLines().length < 4 && Date.now() < deadline;) await delay(100);
    // app.exit(1) is called, but Node keeps a --inspect process alive until its inspector client leaves.
    page.close(); main.close();
    for (const deadline = Date.now() + 10_000; child.exitCode === null && Date.now() < deadline;) await delay(100);
    const lines = guardLines();
    assert.equal(child.exitCode, 1, 'the app must exit with status 1; log: ' + child.logs.join(''));
    assert.equal(lines.length, 4); assert.match(lines[3], /quit; main frame committed about:/);
    return { recoveries: records.length, exit: child.exitCode, lines };
  }));

  await probe('the fixture listeners saw nothing from any app (HTTP, TCP, UDP)', async () => {
    assert.deepEqual({ http: evidence.http.length, tcp: evidence.tcp.length, udp: evidence.udp.length }, { http: 0, tcp: 0, udp: 0 }, JSON.stringify({ http: evidence.http, tcp: evidence.tcp, udp: evidence.udp }));
  });
  await probe('NetLog: no non-app request completed, no TCP connect, no UDP connect except the IPv6 reachability probe', async () => {
    const summary = { files: 0, events: 0, nonAppUrlRequests: 0, nonAppCompleted: 0, nonAppHosts: [], tcpConnectAttempts: 0, udpConnects: {}, resolverJobs: 0, aliveSockets: 0 };
    for (const file of netlogs) {
      let log;
      try { log = JSON.parse(await readFile(file, 'utf8')); } catch { continue; }
      summary.files++; summary.events += log.events.length;
      const names = Object.fromEntries(Object.entries(log.constants.logEventTypes).map(([name, value]) => [value, name]));
      const sources = new Map();
      for (const event of log.events) {
        const type = names[event.type] || '';
        const begin = event.phase === 1;
        if (begin && /^(TCP_CONNECT|TCP_CONNECT_ATTEMPT|SOCKS_CONNECT|SOCKS5_CONNECT)$/.test(type)) summary.tcpConnectAttempts++;
        // connect() on a UDP socket sends nothing; Chromium does it to learn whether IPv6 is routable.
        if (begin && type === 'UDP_CONNECT') { const address = String(event.params?.address); summary.udpConnects[address] = (summary.udpConnects[address] || 0) + 1; }
        if (begin && /^(HOST_RESOLVER_MANAGER_JOB|DNS_TRANSACTION|HOST_RESOLVER_DNS_TASK)$/.test(type)) summary.resolverJobs++;
        // Includes the accepted DevTools sockets of the test inspectors, so it is reported, not asserted.
        if (begin && type === 'SOCKET_ALIVE') summary.aliveSockets++;
        if (type === 'URL_REQUEST_START_JOB' && event.params?.url) sources.set(event.source.id, { url: event.params.url, error: undefined });
        if (type === 'REQUEST_ALIVE' && event.phase === 2 && sources.has(event.source.id)) sources.get(event.source.id).error = event.params?.net_error;
      }
      for (const { url, error } of sources.values()) {
        if (url.startsWith('georama://') || url.startsWith('blob:georama://') || url.startsWith('data:')) continue;
        summary.nonAppUrlRequests++;
        let host = url; try { host = new URL(url).host; } catch { /* keep raw */ }
        if (!summary.nonAppHosts.includes(host)) summary.nonAppHosts.push(host);
        if (error === undefined || error === 0) summary.nonAppCompleted++;
      }
    }
    evidence.observations.netlog = summary;
    assert.ok(summary.files > 0 && summary.events > 0, 'NetLog files must exist and contain events');
    assert.equal(summary.nonAppCompleted, 0, 'a non-app request completed: ' + JSON.stringify(summary));
    assert.equal(summary.tcpConnectAttempts, 0, 'a TCP connection was attempted: ' + JSON.stringify(summary));
    assert.equal(summary.resolverJobs, 0, 'a name was resolved: ' + JSON.stringify(summary));
    for (const address of Object.keys(summary.udpConnects)) assert.match(address, /^\[2001:4860:4860::8888\]:\d+$/, 'unexpected UDP connect: ' + JSON.stringify(summary));
    return summary;
  });
} catch (error) {
  results.push({ name:'harness',status:'FAIL',evidence:error.stack || error.message });
  console.log('FAIL harness: '+(error.stack || error.message));
} finally {
  try { await cleanup(); } catch(error) { results.push({name:'cleanup',status:'FAIL',evidence:String(error)}); console.log('FAIL cleanup: '+error); }
  const counts = Object.fromEntries(['PASS', 'FAIL', 'ACCEPTED'].map(status => [status, results.filter(r => r.status === status).length]));
  await writeFile(reportPath, JSON.stringify({ commit: observedCommit, counts, acceptedRisks: Object.fromEntries(ACCEPTED_RISKS), results, evidence }, null, 2) + '\n');
  console.log('BOUNDARY ' + JSON.stringify(counts) + '; report=' + reportPath);
  for (const [name, risk] of ACCEPTED_RISKS) console.log(`ACCEPTED RISK ${name}: ${risk.reason} (owner: ${risk.owner})`);
  process.exitCode = results.length > 0 && counts.FAIL === 0 ? 0 : 1;
}
