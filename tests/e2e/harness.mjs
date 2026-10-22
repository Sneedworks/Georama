import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

export function rootDir() {
  return root;
}

export async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

export async function targetAt(port, predicate, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`Electron exited before its debugging target was ready (${child.exitCode ?? child.signalCode})`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) });
      const target = (await response.json()).find(predicate);
      if (target?.webSocketDebuggerUrl) return target;
    } catch {
      // The process may still be bringing up its loopback-only inspector.
    }
    await delay(100);
  }
  throw new Error(`No debugging target became ready on port ${port} within 30 seconds`);
}

export async function connect(url, connections) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const listeners = new Map();
  let sequence = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket connection timed out')), 5_000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket connection failed')); }, { once: true });
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    } else {
      for (const listener of listeners.get(message.method) ?? []) listener(message.params);
    }
  });
  socket.addEventListener('close', () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Debugger connection closed'));
    }
    pending.clear();
  });
  const connection = {
    send(method, params = {}, timeoutMs = 10_000) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    async evaluate(expression, timeoutMs = 10_000) {
      const result = await this.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        // CDP defaults to bypassing CSP for eval. Explicitly test the page's real policy.
        allowUnsafeEvalBlockedByCSP: false,
      }, timeoutMs);
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      }
      return result.result.value;
    },
    on(method, listener) {
      listeners.set(method, [...(listeners.get(method) ?? []), listener]);
    },
    close() { socket.close(); },
  };
  if (connections) connections.push(connection);
  return connection;
}

function signalChild(child, signal) {
  if (!child?.pid) return;
  try {
    // Let the launcher forward SIGTERM to Electron before killing any remaining helpers.
    process.kill(signal === 'SIGTERM' ? child.pid : -child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

async function processGroupGone(pgid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { process.kill(-pgid, 0); } catch (error) {
      if (error.code === 'ESRCH') return true;
      if (error.code === 'EPERM') return false; // exists but is not ours: treat as still alive
      throw error;
    }
    if (Date.now() >= deadline) return false;
    await delay(50);
  }
}

/**
 * Launch the hidden app with its own process group and temp user-data dir.
 * Returns { child, temporaryDirectory, connections, shutdown }.
 */
export async function launchApp() {
  const rendererPort = await freePort();
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'georama-e2e-'));
  const connections = [];
  const child = spawn(process.execPath, [
    path.join(root, 'scripts/run-electron.mjs'), '.',
    `--remote-debugging-port=${rendererPort}`,
    `--remote-allow-origins=http://127.0.0.1:${rendererPort}`,
    `--user-data-dir=${temporaryDirectory}`,
  ], {
    cwd: root,
    env: { ...process.env, GEORAMA_E2E: '1', GEORAMA_DEVTOOLS: '0' },
    detached: true,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  let shutdownPromise;
  const shutdown = () => {
    shutdownPromise ??= (async () => {
      let groupError;
      for (const connection of connections) connection.close();
      if (child) {
        const exited = new Promise((resolve) => {
          if (!child.pid || child.exitCode !== null || child.signalCode !== null) resolve();
          else child.once('exit', resolve);
        });
        signalChild(child, 'SIGTERM');
        const timeout = setTimeout(() => signalChild(child, 'SIGKILL'), 3_000);
        try { await exited; } finally { clearTimeout(timeout); }
        // Also reap any remaining helper in the group after the launcher has exited.
        signalChild(child, 'SIGKILL');
        // A successful kill() only means a signal was delivered: observe the group actually disappearing.
        if (child.pid && !await processGroupGone(child.pid, 5_000)) {
          groupError = new Error(`process group ${child.pid} still has live members after SIGKILL`);
        }
      }
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      if (groupError) throw groupError;
    })();
    return shutdownPromise;
  };
  return { child, temporaryDirectory, connections, rendererPort, shutdown };
}
