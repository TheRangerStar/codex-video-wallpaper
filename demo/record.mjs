import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { CDP, attachVideo, removeVideo } from '../wallpaper.mjs';
import { DEFAULT_APPEARANCE } from '../appearance.mjs';

const exec = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(directory, './output');
const run = await fs.mkdtemp(path.join(directory, 'recording-'));
await fs.mkdir(output, { recursive:true });
await fs.mkdir(path.join(run, 'frames'));
const browser = process.env.DEMO_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(browser, ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${path.join(run, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--window-size=1280,800', '--autoplay-policy=no-user-gesture-required', pathToFileURL(path.join(directory,'fixture.html')).href], {stdio:['ignore','ignore','pipe']});
let session, heartbeat;
const frames = [], states = [];
let writes = Promise.resolve();
const options={owner:'release-demo-isolated',opacity:1,paused:true,appearance:DEFAULT_APPEARANCE};
try {
 let port;
 for(let i=0;i<100;i++){
  try{port=Number((await fs.readFile(path.join(run,'profile/DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{}
  await sleep(100);
 }
 assert(port,'隔离浏览器未启动');
 const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 const page=pages.find(p=>p.url===pathToFileURL(path.join(directory,'fixture.html')).href);
 assert(page,'找不到演示页面');
 session=await new CDP(page.webSocketDebuggerUrl).open();
 await session.send('Page.enable');
 await session.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 const renderer=await fs.readFile(path.resolve(directory,'../renderer.js'),'utf8');
 const loaded=await attachVideo(session,renderer,['aurora.mp4','ember.mp4'].map(name=>path.join(directory,'assets',name)),options);
 assert.equal(loaded.state,'playing');
 await session.evaluate('window.originalVideo=document.querySelector("#codex-local-video-layer video")');
 const inspected = await session.evaluate(`({
  title:document.title, sidebarBlur:getComputedStyle(document.querySelector('.app-shell-left-panel')).backdropFilter,
  itemBlur:getComputedStyle(document.querySelector('.sidebar-item')).backdropFilter,
  content:document.querySelector('.assistant-message').innerText, videoCount:document.querySelectorAll('video').length,
  width:innerWidth,height:innerHeight
 })`);
 assert.equal(inspected.sidebarBlur,'blur(12px)');assert.equal(inspected.itemBlur,'none');assert.equal(inspected.videoCount,1);
 console.log('演示页面已加载：'+JSON.stringify(inspected));
 if(process.argv.includes('--preview')) {
  const shot=await session.send('Page.captureScreenshot',{format:'png'});
  await fs.writeFile(path.join(output,'preview.png'),Buffer.from(shot.data,'base64'));
  process.exitCode=0;
 } else {
  session.on('Page.screencastFrame',data=>{
   const index=frames.length,name=`frame-${String(index).padStart(5,'0')}.jpg`;
   frames.push({name,time:data.metadata.timestamp});
   writes=writes.then(()=>fs.writeFile(path.join(run,'frames',name),Buffer.from(data.data,'base64')));
   void session.send('Page.screencastFrameAck',{sessionId:data.sessionId}).catch(()=>{});
  });
  await session.send('Page.startScreencast',{format:'jpeg',quality:93,maxWidth:1280,maxHeight:800,everyNthFrame:1});
  await session.evaluate('window.__codexLocalVideoWallpaper.update('+JSON.stringify({...options,paused:false})+')');
  heartbeat=setInterval(()=>session.evaluate('window.__codexLocalVideoWallpaper.heartbeat()').catch(()=>{}),2000);
  const start=Date.now();
  const at=async ms=>{await sleep(Math.max(0,start+ms-Date.now()));};
  const snapshot=async name=>{
   const shot=await session.send('Page.captureScreenshot',{format:'png'});
   await fs.writeFile(path.join(output,name+'.png'),Buffer.from(shot.data,'base64'));
   states.push({atMs:Date.now()-start,name,...await session.evaluate('window.__codexLocalVideoWallpaper.report()')});
  };
  await at(1800);await snapshot('cover');
  await at(5500);await session.evaluate('window.showChat(2)');
  await at(7850);await snapshot('transition-before');
  await at(8250);await snapshot('transition-middle');
  await at(8900);await snapshot('transition-after');
  await at(10500);await session.evaluate('document.getElementById("settings").click()');
  await at(12000);await snapshot('settings');
  assert(await session.evaluate('window.originalVideo===document.querySelector("#codex-local-video-layer video")'));
  const settings=await session.evaluate('({bg:getComputedStyle(document.querySelector(".settings-group")).backgroundColor,ink:getComputedStyle(document.querySelector(".setting-label")).color})');
  assert.equal(settings.bg,'rgba(0, 0, 0, 0)');
  await at(15500);await session.evaluate('document.getElementById("back").click()');
  await at(18000);await snapshot('return');
  assert(await session.evaluate('window.originalVideo===document.querySelector("#codex-local-video-layer video")'));
  await at(21500);
  await session.send('Page.stopScreencast');
  clearInterval(heartbeat);heartbeat=null;
  await writes;
  assert(frames.length>100,'录制帧数不足');
  const timeline=frames.map((frame,i)=>`file 'frames/${frame.name}'\nduration ${Math.max(.001,(frames[i+1]?.time??frame.time+1/30)-frame.time).toFixed(6)}`).join('\n')+`\nfile 'frames/${frames.at(-1).name}'\n`;
  await fs.writeFile(path.join(run,'timeline.txt'),timeline);
  await exec('ffmpeg',['-y','-v','error','-f','concat','-safe','0','-i',path.join(run,'timeline.txt'),'-vf','fps=30','-an','-c:v','libx264','-preset','slow','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',path.join(output,'codex-video-wallpaper-demo.mp4')],{maxBuffer:1024*1024});
  await exec('ffmpeg',['-y','-v','error','-ss','5.5','-i',path.join(output,'codex-video-wallpaper-demo.mp4'),'-t','8','-filter_complex','[0:v]fps=10,scale=768:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4','-loop','0',path.join(output,'preview.gif')],{maxBuffer:1024*1024});
  const manifest={fixture:'示例界面 · 实际壁纸渲染',privateData:false,originalAbstractBackgrounds:true,rendererSource:'renderer.js',appearance:DEFAULT_APPEARANCE,recordedFrames:frames.length,duration:frames.at(-1).time-frames[0].time,viewport:{width:1280,height:800},inspected,settings,states};
  await fs.writeFile(path.join(directory,'verification.json'),JSON.stringify(manifest,null,2));
  console.log('录制完成：'+JSON.stringify({frames:frames.length,duration:manifest.duration,output}));
 }
}finally{
 clearInterval(heartbeat);
 if(session){await removeVideo(session,options.owner).catch(()=>{});session.close();}
 chrome.kill('SIGTERM');
}
