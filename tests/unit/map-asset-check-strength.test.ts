import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as cfg from '../../electron/data/config-file.ts';
import * as selected from '../../electron/data/selected-file.ts';
import * as wd from '../../src/core/formats/wonderdraft-map-file.ts';
import * as refs from '../../src/core/assets/map-refs.ts';
import * as stores from '../../electron/assets/store.ts';
import { checkSelectedMapAssets } from '../../electron/data/map-asset-check.ts';
import { makeAssetCheckFixture } from '../helpers/asset-check-synthetic.ts';
import { buildPck, makePng } from '../helpers/pck-synthetic.ts';
const cleanup: Array<() => Promise<void>> = [];
async function fixture() { const f = await makeAssetCheckFixture(); cleanup.push(f.cleanup); return f; }
afterEach(async () => { vi.restoreAllMocks(); for (const f of cleanup.splice(0)) await f(); });

it.each(['map','config'] as const)('does not trim refused %s filename into an existing selected input', async which => {
 const f=await fixture();
 await expect(checkSelectedMapAssets(f.mapFile+(which==='map'?' ':''),f.configFile+(which==='config'?' ':''))).rejects.toMatchObject({code:'EXTENSION'});
});
it.each(['caf\u00e9%20','cafe\u0301%20'])('preserves actual opaque selected filenames %s', async name => {
 const f=await fixture(), c=path.join(f.base,name+'.json'),m=path.join(f.base,name+'.wonderdraft_map');
 await fs.copyFile(f.configFile,c);await fs.copyFile(f.mapFile,m);
 const cs=vi.spyOn(cfg,'readSelectedConfigFile'), ds=vi.spyOn(selected,'readSelectedDataFile');
 expect((await checkSelectedMapAssets(m,c)).valid).toBe(6);
 expect(cs).toHaveBeenCalledExactlyOnceWith(c);expect(ds).toHaveBeenCalledWith(m,536870912);
});
it('awaits complete configuration before starting any map read', async () => {
 const f=await fixture(), orig=cfg.readSelectedConfigFile;
 let enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(r=>{enter=r;}),gate=new Promise<void>(r=>{release=r;});
 vi.spyOn(cfg,'readSelectedConfigFile').mockImplementation(async filename=>{enter();await gate;return orig(filename);});
 const read=vi.spyOn(selected,'readSelectedDataFile'); const pending=checkSelectedMapAssets(f.mapFile,f.configFile);
 try {await entered;await tick();expect(read).not.toHaveBeenCalled();} finally {release();await pending;}
});
it('passes the native encoded backing region to the parser without copying it', async () => {
 const f=await fixture(),orig=selected.readSelectedDataFile;let native:Uint8Array|undefined;
 vi.spyOn(selected,'readSelectedDataFile').mockImplementation(async(filename,cap)=>{const b=await orig(filename,cap);if(filename===f.mapFile)native=b;return b;});
 const parse=vi.spyOn(wd,'readWdMap');await checkSelectedMapAssets(f.mapFile,f.configFile);
 const actual=parse.mock.calls[0]![0];expect(native).toBeDefined();expect(actual.buffer).toBe(native!.buffer);expect(actual.byteOffset).toBe(native!.byteOffset);expect(actual.byteLength).toBe(native!.byteLength);
});
it('pins every status row, frozen locations, raw names and exact image arguments', async () => {
 const f=await fixture(),raw=' Cafe\u0301 ';
 await fs.writeFile(path.join(f.installRoot,'Wonderdraft.pck'),buildPck([{path:'res://textures/ground/'+raw+'.wonderdraft_image',data:makePng()}]));
 const groups=Object.freeze([
  Object.freeze({kind:'frame-texture' as const,reference:'cafe\u0301',locations:Object.freeze(['/bad/a','/bad/b'])}),
  Object.freeze({kind:'ground-texture' as const,reference:raw,locations:Object.freeze(['/good'])}),
  Object.freeze({kind:'water-texture' as const,reference:'',locations:Object.freeze(['/empty'])}),
 ]);
 vi.spyOn(refs,'collectMapAssetRefs').mockReturnValue(Object.freeze({groups,embeddedSymbolLocations:Object.freeze(['/embedded/a','/embedded/b'])}));
 const orig=stores.createAssetStore;const calls:unknown[][]=[];
 vi.spyOn(stores,'createAssetStore').mockImplementation(async o=>{const s=await orig(o),read=s.readImage.bind(s);s.readImage=async(...args)=>{calls.push(args);return read(...args);};return s;});
 const r=await checkSelectedMapAssets(f.mapFile,f.configFile);
 expect(r).toMatchObject({version:1,ok:false,groups:3,checked:2,valid:1,unresolved:1,empty:1,embeddedSymbols:2});
 expect(r.entries).toEqual(groups.map((g,i)=>({...g,status:['unresolved','valid','empty'][i]})));
 for(const e of r.entries){expect(Object.isFrozen(e)).toBe(true);expect(Object.isFrozen(e.locations)).toBe(true);}
 expect(calls).toEqual([['frame-texture','cafe\u0301'],['ground-texture',raw]]);
});
it('captures opaque image errors without inspecting their properties or coercing them', async () => {
 const f=await fixture(),orig=stores.createAssetStore;
 const poison=new Proxy(Object.create(null) as object,{get(){throw new Error('inspected');},has(){throw new Error('inspected');},getPrototypeOf(){throw new Error('inspected');}});
 vi.spyOn(stores,'createAssetStore').mockImplementation(async o=>{const s=await orig(o);s.readImage=async()=>{throw poison;};return s;});
 expect(await checkSelectedMapAssets(f.mapFile,f.configFile)).toMatchObject({checked:6,valid:0,unresolved:6,ok:false});
});
it.each(['','bad'])('waits for native-close reporting even for non-valid reference %j', async reference => {
 const f=await fixture(),orig=stores.createAssetStore;let notify!:()=>void,release!:()=>void,closed=0;
 const entered=new Promise<void>(r=>{notify=r;}),gate=new Promise<void>(r=>{release=r;});
 vi.spyOn(refs,'collectMapAssetRefs').mockReturnValue({groups:[Object.freeze({kind:'frame-texture' as const,reference,locations:Object.freeze(['/frame/texture'])})],embeddedSymbolLocations:[]});
 vi.spyOn(stores,'createAssetStore').mockImplementation(async o=>{const s=await orig(o),close=s.close.bind(s);s.close=async()=>{await close();closed++;notify();await gate;};return s;});
 const pending=checkSelectedMapAssets(f.mapFile,f.configFile);let settled=false;void pending.then(()=>{settled=true;},()=>{settled=true;});
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {await Promise.race([entered,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('native close not entered')),1500);})]);await tick();expect(closed).toBe(1);expect(settled).toBe(false);}
 finally {if(timer)clearTimeout(timer);release();await pending;}
 expect(closed).toBe(1);
});
it.each(['config','map','parse','validate','inventory','store'] as const)('preserves %s phase failure identity', async stage => {
 const f=await fixture(),marker=new Error('phase-marker');
 if(stage==='config')vi.spyOn(cfg,'readSelectedConfigFile').mockRejectedValueOnce(marker);
 if(stage==='map'){const native=selected.readSelectedDataFile;vi.spyOn(selected,'readSelectedDataFile').mockImplementation(async(name,cap)=>{if(name===f.mapFile)throw marker;return native(name,cap);});}
 if(stage==='parse')vi.spyOn(wd,'readWdMap').mockImplementationOnce(()=>{throw marker;});
 if(stage==='validate')vi.spyOn(wd,'validateWdMap').mockImplementationOnce(()=>{throw marker;});
 if(stage==='inventory')vi.spyOn(refs,'collectMapAssetRefs').mockImplementationOnce(()=>{throw marker;});
 if(stage==='store')vi.spyOn(stores,'createAssetStore').mockRejectedValueOnce(marker);
 await expect(checkSelectedMapAssets(f.mapFile,f.configFile)).rejects.toBe(marker);
});
it('actually checks a corrupt PNG rather than just a refused reference string', async () => {
 const f=await fixture();await fs.writeFile(path.join(f.userDataRoot,'assets/synthetic-pack/trees/tree.png'),new Uint8Array([1,2,3]));
 const r=await checkSelectedMapAssets(f.mapFile,f.configFile);expect(r.unresolved).toBe(1);expect(r.valid).toBe(5);expect(r.entries.find(e=>e.kind==='symbol')?.status).toBe('unresolved');
});
it.each(['map','config'] as const)('CLI does not trim a refused %s selection', async which => {
 const f=await fixture(),run=promisify(execFile);
 try {
  await run(process.execPath,['scripts/check-map-assets.ts','--config',f.configFile+(which==='config'?' ':''),'--map',f.mapFile+(which==='map'?' ':'')],{cwd:process.cwd(),env:{PATH:process.env.PATH,HOME:f.base,XDG_CONFIG_HOME:f.base,TMPDIR:f.base},timeout:10000});
  expect.unreachable('must refuse raw filename');
 } catch(error) {
  const e=error as {code?:unknown;stdout?:string;stderr?:string};expect(e.code).toBe(2);expect(e.stdout).toBe('');expect(e.stderr).toBe('{"ok":false,"error":"CHECK_FAILED"}\n');
 }
});
