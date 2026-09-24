// 手动浏览器回归：node tests/composer-surfaces.mjs <本机客户端 CSS 快照目录>
// 只打开自建页面，不连接 Codex；官方 CSS 留在本机，不随项目分发。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP } from '../wallpaper.mjs';

const fixtureDir = path.resolve(process.argv[2] || '.');
const renderer = await fs.readFile(process.env.WALLPAPER_RENDERER || new URL('../renderer.js', import.meta.url), 'utf8');
const files = await fs.readdir(fixtureDir);
const css = ['app-shared-fixture.css', 'app-initial-fixture.css', ...files.filter(f => /^app-primary-.*\.css$/.test(f))];
assert.equal(css.length, 3, '需要 shared、initial、primary 三份客户端 CSS');
const styles = (await Promise.all(css.map(f => fs.readFile(path.join(fixtureDir, f), 'utf8')))).join('\n');
const utilityClass = styles.match(/_ComposerHomeUtilityBar_\w+/)?.[0];
assert(utilityClass, '此快照没有新版项目栏，不能用来验证该组件');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wallpaper-composer-'));
const pagePath = path.join(temp, 'fixture.html');
const preview = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#0785e8"/><circle cx="80" cy="45" r="30" fill="#ffc400"/></svg>');
const tile = (id, ready = false) => `<span class="group/composer-attachment relative block h-30.5 w-40 shrink-0 select-none">
  <span id="${id}" class="composer-attachment-surface flex size-full flex-col overflow-hidden rounded-2xl bg-surface-secondary text-default">
    <span class="pointer-events-none flex h-22.5 shrink-0 items-center justify-center overflow-hidden">${ready ? `<img id="preview" src="${preview}" class="size-full object-cover object-left-top">` : '<span id="fallback" class="text-secondary">文件预览</span>'}</span>
    <span id="${id}-label" class="pointer-events-none flex h-8 min-w-0 shrink-0 items-center gap-1 bg-surface px-2 text-xs leading-4"><span style="color:#0085ff">▤</span><span class="truncate">example.md</span></span>
    <span class="composer-attachment-surface pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-border" aria-hidden="true"></span>
    <button id="${id}-open" class="composer-attachment-surface absolute inset-0 rounded-2xl" aria-label="预览文件"></button>
  </span><button id="${id}-remove" class="absolute -top-0.5 -right-0.5 bg-primary-solid text-primary-solid rounded-full" aria-label="移除文件">×</button></span>`;
await fs.writeFile(pagePath, `<!doctype html><html data-theme="light" data-codex-os="darwin"><head><meta charset="utf-8"><style>${styles}</style><style>
  html,body{margin:0;height:100%;font-family:system-ui}#root{padding:50px;min-height:100vh}main{max-width:760px;margin:auto}
  #utility{border-radius:16px 16px 0 0;padding:14px;display:flex;gap:24px}#surface{position:relative;border-radius:24px;background:var(--composer-layout-surface-background);backdrop-filter:var(--composer-layout-surface-backdrop-filter);padding:24px}
  [data-composer-attachments]{display:flex;gap:20px}.reference{padding:16px;margin-top:18px}#draft{display:block;min-height:75px;margin-top:20px}
  :root{--color-surface:#fff;--color-surface-secondary:#e4e4e4;--color-background-composer-action-bar:#e3e3e3;--color-background-primary-solid:#000;--color-text-primary-solid:#fff;--color-text:#171717;--color-text-secondary:#555;--color-text-tertiary:#666}
</style></head><body><div id="root"><main data-app-shell-main-surface>
  <div id="utility" class="${utilityClass} text-default" data-composer-placement="home" data-composer-rail-item="present"><button id="project" class="text-default">示例项目</button><span class="text-secondary">本地</span><button id="branch" class="text-secondary">main</button></div>
  <div id="surface" data-composer-surface-variant="default"><div data-composer-attachments data-composer-spacing="default">${tile('attachment')}${tile('image', true)}</div><div id="draft" contenteditable="true">输入区域：项目栏和附件应与这里一致</div></div>
  <div id="outside" class="reference bg-surface">普通白色面板</div><div id="dialog" role="dialog" class="reference bg-surface text-default">原生对话框</div>
</main></div></body></html>`);
const chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${temp}/profile`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--window-size=1050,740', pathToFileURL(pagePath).href,
], { stdio: ['ignore', 'ignore', 'pipe'] });
let cdp, stderr = '';
chrome.stderr.on('data', b => { stderr = (stderr + b).slice(-2000); });
const checks = [];
const pass = name => { checks.push(name); console.log('通过：' + name); };
const read = `(() => {
  const s = id => {const e=document.getElementById(id), c=getComputedStyle(e);return {bg:c.backgroundColor,color:c.color,blur:c.backdropFilter,filter:c.filter,opacity:c.opacity};};
  return Object.fromEntries(['utility','project','branch','surface','attachment','attachment-label','image','image-label','preview','attachment-remove','outside','dialog'].map(id=>[id,s(id)]));
})()`;
function contrast(color, bg, under = [255, 255, 255]) {
  const nums = s => s.match(/[\d.]+/g).map(Number);
  const fg = nums(color), plate = nums(bg), alpha = plate[3] ?? 1;
  const lum = rgb => rgb.slice(0,3).reduce((a,v,i) => {v/=255;return a+[.2126,.7152,.0722][i]*(v<=.04045?v/12.92:((v+.055)/1.055)**2.4);},0);
  const a=lum(fg), b=lum(under.map((v,i)=>plate[i]*alpha+v*(1-alpha)));
  return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}
try {
  let port;
  for (let i=0;i<100;i++) {
    if(chrome.exitCode!==null) throw Error(stderr);
    try {port=Number((await fs.readFile(`${temp}/profile/DevToolsActivePort`,'utf8')).split('\n')[0]);break;} catch {}
    await sleep(100);
  }
  assert(port, '隔离浏览器未启动');
  const pages=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page=pages.find(p=>p.url===pathToFileURL(pagePath).href);
  assert(page);cdp=await new CDP(page.webSocketDebuggerUrl).open();
  await cdp.evaluate('document.fonts.ready.then(()=>true)');
  const original=await cdp.evaluate(read);
  assert.equal(original['attachment-label'].bg,'rgb(255, 255, 255)');
  await cdp.evaluate(`document.getElementById('attachment-open').onclick=()=>window.openCount=(window.openCount||0)+1;document.getElementById('attachment-remove').onclick=()=>window.removeCount=(window.removeCount||0)+1`);
  const options={owner:'isolated-composer-test',opacity:1,paused:true,appearance:{mode:'fixed',color:'#fff4e6',glass:.28,shadow:'soft'}};
  await cdp.evaluate(`(${renderer})(${JSON.stringify(options)})`);
  const fixed=await cdp.evaluate(read);
  assert.equal(fixed.utility.bg,fixed.surface.bg);
  assert.equal(fixed.utility.blur,'blur(18px)');
  assert(contrast(fixed.project.color,fixed.utility.bg)>=4.5);
  assert(contrast(fixed.branch.color,fixed.utility.bg)>=4.5);
  pass('独立项目/环境栏与输入框玻璃一致，主次文字在白色背景上对比度均达 4.5');
  for(const id of ['attachment','attachment-label','image','image-label']) assert.equal(fixed[id].bg,'rgba(0, 0, 0, 0)',id);
  assert(contrast(fixed['attachment-label'].color,fixed.surface.bg)>=4.5);
  pass('附件预览占位及文件名白底移除，文件名保持可读');
  for(const key of ['bg','blur','filter','opacity']) assert.equal(fixed.preview[key],original.preview[key],`preview ${key}`);
  assert.equal(await cdp.evaluate('document.getElementById("preview").src'),preview);
  assert.equal(fixed.outside.bg,original.outside.bg);
  for(const id of ['attachment-remove','dialog']) assert.deepEqual(fixed[id],original[id],id);
  pass('真实缩略图、删除按钮、区域外面板与原生对话框未改变');
  for(const id of ['attachment-open','attachment-remove']) {
    const point=await cdp.evaluate(`(()=>{const r=document.getElementById('${id}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
  }
  assert.deepEqual(await cdp.evaluate('[window.openCount,window.removeCount]'),[1,1]);
  pass('鼠标点击附件预览和移除按钮仍能分别触发');
  await cdp.evaluate(`document.getElementById('utility').replaceWith(document.getElementById('utility').cloneNode(true));document.getElementById('attachment').replaceWith(document.getElementById('attachment').cloneNode(true))`);
  assert.deepEqual(await cdp.evaluate(read),fixed);
  pass('切页重建项目栏或动态添加附件后样式自动生效');
  if(process.env.QA_SCREENSHOT) await fs.writeFile(process.env.QA_SCREENSHOT,Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await cdp.evaluate(`window.__codexLocalVideoWallpaper.update(${JSON.stringify({...options,appearance:{...options.appearance,color:'#18202a'}})})`);
  const dark=await cdp.evaluate(read);
  assert(contrast(dark.project.color,dark.utility.bg,[0,0,0])>=4.5);
  assert(contrast(dark.branch.color,dark.utility.bg,[0,0,0])>=4.5);
  assert(contrast(dark['attachment-label'].color,dark.surface.bg,[0,0,0])>=4.5);
  pass('自选深色文字时使用浅色玻璃，黑色背景上仍可读');
  await cdp.evaluate('window.__codexLocalVideoWallpaper.remove()');
  assert.deepEqual(await cdp.evaluate(read),original);
  pass('关闭壁纸完整恢复项目栏及附件原始样式');
  console.log(JSON.stringify({fixture:path.basename(fixtureDir),checks}));
} finally {
  cdp?.close();chrome.kill();
  for(let i=0;i<30&&chrome.exitCode===null;i++) await sleep(100);
  await fs.rm(temp,{recursive:true,force:true});
}
