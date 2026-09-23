import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeAppearance } from '../appearance.mjs';
import { parseArgs, resolveVideos, connectApp, targetAllowed } from '../wallpaper.mjs';
import { isManagedWorker } from '../storage.mjs';
import { runEntry, VERSION } from '../terminal-entry.mjs';

test('外观配置拒绝任意 CSS 和越界参数', () => {
 assert.equal(normalizeAppearance({color:'#C5F7EE'}).color,'#c5f7ee');
 for(const v of [{color:'red;display:none'},{glass:.61},{mode:'bad'},{extra:true}])assert.throws(()=>normalizeAppearance(v));
});
test('视频丢失时恢复剩余列表，新选择严格验证',async()=>{
 const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'video-list-')));
 try{
  const a=path.join(dir,'one.mp4'),b=path.join(dir,'two.mp4');
  const bytes=Buffer.alloc(128);bytes.write('ftyp',4);await fs.writeFile(b,bytes);
  const r=await resolveVideos(parseArgs([a,b,'--restore','--start-index','1']));
  assert.deepEqual(r.videos,[b]);assert.equal(r.startIndex,0);assert.deepEqual(r.unavailableVideos,[a]);
  assert.deepEqual((await resolveVideos(parseArgs([a,'--restore']))).videos,[]);
  await assert.rejects(resolveVideos(parseArgs([a,b])),{code:'ENOENT'});
  await fs.writeFile(a,bytes);assert.deepEqual((await resolveVideos(parseArgs([a,b,'--restore']))).videos,[a,b]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('跨版本后台限定在同一 Brew 包',()=>{
 const root='/Cellar/codex-wallpaper',current=root+'/0.2.0/libexec/background.mjs';
 assert(isManagedWorker(root+'/0.1.0/libexec/background.mjs',current,root));
 for(const s of ['/tmp/background.mjs',root+'/../other/0.1.0/libexec/background.mjs',root+'/0.1.0/bin/background.mjs'])assert.equal(isManagedWorker(s,current,root),false);
 assert.equal(isManagedWorker(root+'/0.1.0/libexec/background.mjs','/tmp/background.mjs',root),false);
});
test('调试窗口只接受本机应用页面',()=>{
 const t={type:'page',id:'main',url:'app://-/settings',webSocketDebuggerUrl:'ws://127.0.0.1:9463/devtools/page/main'};
 assert(targetAllowed(t,9463));
 for(const v of [{url:'https://example.com'},{url:'app://-/avatar-overlay'},{webSocketDebuggerUrl:'ws://example.com:9463/devtools/page/main'}])assert.equal(targetAllowed({...t,...v},9463),false);
});
test('更新等待端口恢复，不主动退出客户端',async()=>{
 let step=0,launches=0;const phases=[];
 const result=await connectApp({getApp:()=>({version:step?'26.917.51856':'26.915.31945'}),port:9463,stopped:()=>false,onState:s=>phases.push(s)},{probe:()=>step>=2,running:()=>true,wait:async()=>{step++;},launch:()=>{launches++;},now:()=>step*1000});
 assert.equal(result.version,'26.917.51856');assert.equal(launches,0);assert.deepEqual(phases,['waiting-for-exit','waiting-for-exit']);
});
test('帮助与版本不会探测主机或连接',async()=>{
 let out='';const opts={input:{isTTY:false},output:{write:s=>out+=s},machine:()=>{throw Error('不应探测');},openConsole:()=>{throw Error('不应连接');}};
 assert.equal(await runEntry(['--version'],opts),0);assert.equal(out,VERSION+'\n');out='';assert.equal(await runEntry(['--help'],opts),0);assert.match(out,/codex-wallpaper/);
});
