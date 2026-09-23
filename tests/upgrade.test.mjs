import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('后台跨目录升级保留配置并结束自己的旧进程',{timeout:20000},async()=>{
 const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-upgrade-')));
 const root=path.join(dir,'Cellar/codex-wallpaper'),data=path.join(dir,'Library/Application Support/codex-video-wallpaper');
 const before=[process.env.CODEX_WALLPAPER_DATA_DIR,process.env.CODEX_WALLPAPER_INSTALL_ROOT];
 process.env.CODEX_WALLPAPER_DATA_DIR=data;process.env.CODEX_WALLPAPER_INSTALL_ROOT=root;
 let first,second;
 try{
  const folders=['0.1.0','0.2.0'].map(v=>path.join(root,v,'libexec'));
  for(const folder of folders){
   await fs.mkdir(folder,{recursive:true});
   for(const n of ['background.mjs','appearance.mjs','storage.mjs','terminal-output.mjs'])await fs.copyFile(new URL('../'+n,import.meta.url),path.join(folder,n));
   await fs.writeFile(path.join(folder,'wallpaper.mjs'),`
import {setTimeout as sleep} from 'node:timers/promises';
import {readPreferences,readAppearance} from './appearance.mjs';
export async function main(args,{onStatus=()=>{}}={}){
 if(args.includes('--check'))return;
 let stop=false;process.on('SIGTERM',()=>{stop=true;});
 while(!stop){onStatus({phase:'connected',connected:true,videos:readPreferences().videos??[],appearance:readAppearance(),updatedAt:Date.now()});await sleep(50);}
}
if(process.argv[1].endsWith('/wallpaper.mjs'))await main(process.argv.slice(2));
`);
  }
  first=await import(pathToFileURL(path.join(folders[0],'background.mjs')));
  const prefs=await import(pathToFileURL(path.join(folders[0],'appearance.mjs')));
  prefs.writePreferences({videos:['/example/local.mp4'],appearance:{mode:'fixed',color:'#c5f7ee',glass:.28,shadow:'soft'}});
  const saved=await fs.readFile(path.join(data,'.wallpaper-settings.json'),'utf8');
  await first.reconnect();const old=first.status();assert(old.running&&old.connected);
  second=await import(pathToFileURL(path.join(folders[1],'background.mjs')));assert.equal(second.status().pid,old.pid);
  const current=await second.reconnect();assert(current.running&&current.connected);assert.notEqual(current.pid,old.pid);
  assert.equal(current.script,path.join(folders[1],'background.mjs'));assert.throws(()=>process.kill(old.pid,0),{code:'ESRCH'});
  assert.equal(await fs.readFile(path.join(data,'.wallpaper-settings.json'),'utf8'),saved);
  assert.equal((await fs.stat(path.join(data,'.wallpaper-settings.json'))).mode&0o777,0o600);
  assert.equal(current.appearance.color,'#c5f7ee');assert.equal((await second.reconnect()).pid,current.pid);
  await second.stop();assert.equal(second.status().running,false);
  assert.equal(await fs.readFile(path.join(data,'.wallpaper-settings.json'),'utf8'),saved);
  for(const folder of folders)await assert.rejects(fs.stat(path.join(folder,'.wallpaper-settings.json')),{code:'ENOENT'});
 }finally{
  if(second)await second.stop();if(first)await first.stop();
  for(const [i,k] of ['CODEX_WALLPAPER_DATA_DIR','CODEX_WALLPAPER_INSTALL_ROOT'].entries()){if(before[i]===undefined)delete process.env[k];else process.env[k]=before[i];}
  await fs.rm(dir,{recursive:true,force:true});
 }
});
