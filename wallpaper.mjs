import fs from 'node:fs/promises';
import { appendFileSync, writeFileSync, watch } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { emitKeypressEvents } from 'node:readline';
import { readAppearance, readPreferences, writePreferences } from './appearance.mjs';
import { paint } from './terminal-output.mjs';
import { findCodexApp } from './app-discovery.mjs';
import { DATA_DIR, SETTINGS, LOG, ensureDataDir } from './storage.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TAG = '[CodeX视频壁纸]';
const KEY = '__codexLocalVideoWallpaper';
let logFile;
const log = (text, level = 'info') => {
  const line = `${TAG} ${text}`;
  console.log(paint(line, level));
  if (logFile) { try { appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`); } catch {} }
};
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 10000 }).trim();

export function parseArgs(args) {
  const options = { video: null, videos: [], startIndex: 0, opacity: 1, port: 9463, check: false, help: false, restore: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--check') options.check = true;
    else if (arg === '--restore') options.restore = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--opacity') options.opacity = Number(args[++i]);
    else if (arg === '--port') options.port = Number(args[++i]);
    else if (arg === '--start-index') options.startIndex = Number(args[++i]);
    else if (!arg.startsWith('-')) options.videos.push(path.resolve(arg));
    else throw new Error(`无法识别的参数：${arg}`);
  }
  if (!Number.isFinite(options.opacity) || options.opacity < 0 || options.opacity > 1) {
    throw new Error('--opacity 必须在 0 到 1 之间。');
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error('--port 必须在 1024 到 65535 之间。');
  }
  options.videos = [...new Set(options.videos)];
  options.video = options.videos[0] ?? null;
  if (!Number.isInteger(options.startIndex) || options.startIndex < 0 || options.startIndex >= Math.max(1, options.videos.length)) throw new Error('视频起始位置超出播放列表。');
  return options;
}

export class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.method) {
        for (const listener of this.listeners.get(message.method) || []) listener(message.params);
        return;
      }
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.pending.delete(message.id);
      message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
    });
    this.ws.addEventListener('close', () => this.rejectPending());
    this.ws.addEventListener('error', () => this.rejectPending());
  }
  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(listener);
  }
  rejectPending() {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('与窗口的连接已断开。'));
    }
    this.pending.clear();
  }
  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return this;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.ws.close(); reject(new Error('连接窗口超时。')); }, 4000);
      this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('无法连接窗口。')); }, { once: true });
    });
    return this;
  }
  send(method, params = {}) {
    if (this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('窗口连接已关闭。'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 超时。`));
      }, 18000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }
  close() { this.rejectPending(); this.ws.close(); }
}

export async function attachVideo(session, renderer, video, options) {
  if (Array.isArray(video) ? video.length === 0 : !video) {
    // 未选视频时只确认主窗口已响应，不挂载视频或修改原界面样式。
    return session.evaluate("document.readyState === 'loading' ? {state:'connecting'} : {state:'connected'}");
  }
  const controls = JSON.stringify({ owner: options.owner, opacity: options.opacity, paused: options.paused, appearance: options.appearance });
  const operation = session.wallpaperControls === controls ? 'heartbeat()' : `update(${controls})`;
  let result = await session.evaluate(`window.${KEY} ? (window.${KEY}.owner === ${JSON.stringify(options.owner)} ? window.${KEY}.${operation} : {state:'busy'}) : {state:'missing'}`);
  if (result?.state === 'missing') result = await session.evaluate(`(${renderer})(${JSON.stringify(options)})`);
  if (result?.state !== 'busy') session.wallpaperControls = controls;
  if (result?.state !== 'needs-file') return result;
  try {
    const { root } = await session.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#codex-local-video-file' });
    if (!nodeId) throw new Error('本地视频入口未创建。');
    await session.send('DOM.setFileInputFiles', { nodeId, files: Array.isArray(video) ? video : [video] });
    result = await session.evaluate(`window.${KEY}.load()`);
    if (result?.state === 'error') throw new Error(result.error);
    return result;
  } catch (error) {
    await removeVideo(session, options.owner).catch(() => {});
    throw error;
  }
}

export function removeVideo(session, owner) {
  return session.evaluate(`window.${KEY}?.owner === ${JSON.stringify(owner)} ? window.${KEY}.remove() : null`);
}

function running(app) {
  return run('/bin/ps', ['-axo', 'comm=']).split('\n').some(line => line.trim() === app.executable);
}

export async function requestAppQuit() {
  findCodexApp();
  run('/usr/bin/osascript', ['-e', 'tell application id "com.openai.codex" to quit']);
}

// 等待期间持续探测端口：端口恢复即接入，无需再次点击“启用”。
// 已运行的客户端缺少启动端口时，等待用户退出；不自动打断任务。
export async function connectApp({ getApp, port, stopped, onState }, overrides = {}) {
  const io = {
    probe: endpointOwnedByApp, running, wait: sleep, now: Date.now,
    launch: app => run('/usr/bin/open', ['-na', app.bundle, '--args', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`]),
    ...overrides,
  };
  let launchedAt = null;
  while (!stopped()) {
    const app = getApp();
    if (io.probe(app, port)) return app;
    if (!io.running(app) && launchedAt === null) {
      io.launch(app);
      launchedAt = io.now();
    }
    onState(launchedAt === null ? 'waiting-for-exit' : 'connecting');
    if (launchedAt !== null && io.now() - launchedAt >= 45000) {
      throw new Error(`Codex 重开后仍未开放本机端口 ${port}，请查看运行日志。`);
    }
    await io.wait(1000);
  }
  return null;
}

// 辅助进程可能安装在应用包外，并继承父进程的监听 socket。
// 必须沿真实父进程链找到同样持有该端口的 Codex 进程，不能只按进程名字放行。
export function listenerBelongsToApp(pid, app, listeners, processes) {
  const seen = new Set();
  while (pid && !seen.has(pid)) {
    seen.add(pid);
    const process = processes.get(pid);
    if (!process) return false;
    if (listeners.has(pid) && (process.executable === app.executable ||
        process.executable.startsWith(`${app.bundle}/Contents/Frameworks/`))) return true;
    pid = process.parent;
  }
  return false;
}

// 在连接调试端口前，核对监听进程和继承关系，且只允许本机地址。
export function endpointOwnedByApp(app, port) {
  let output;
  try { output = run('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpn']); }
  catch (error) { if (error.status === 1) return false; throw error; }
  const pids = [...new Set(output.split('\n').filter(line => /^p\d+$/.test(line)).map(line => line.slice(1)))];
  const addresses = output.split('\n').filter(line => line.startsWith('n')).map(line => line.slice(1));
  if (!pids.length) return false;
  if (!addresses.length || addresses.some(value => value !== `127.0.0.1:${port}` && value !== `[::1]:${port}`)) {
    throw new Error(`端口 ${port} 未限定在本机回环地址，停止连接。`);
  }
  const processes = new Map();
  for (const line of run('/bin/ps', ['-axo', 'pid=,ppid=,comm=']).split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (match) processes.set(match[1], { parent: match[2], executable: match[3] });
  }
  const listeners = new Set(pids);
  for (const pid of pids) {
    // lsof 与 ps 之间进程可能已退出；仍存活的监听者必须全部通过检查。
    if (!processes.has(pid)) continue;
    if (!listenerBelongsToApp(pid, app, listeners, processes)) {
      throw new Error(`端口 ${port} 被其他程序占用；可以用 --port 指定其他端口。`);
    }
  }
  return pids.some(pid => processes.has(pid));
}

export function targetAllowed(target, port) {
  try {
    const page = new URL(target.url);
    const ws = new URL(target.webSocketDebuggerUrl);
    // 页面导航会改变 pathname；以应用来源和实际窗口结构识别，不锁定首页 URL。
    const routes = [page.pathname, page.searchParams.get('initialRoute') || ''];
    return target.type === 'page' && page.protocol === 'app:' && page.hostname === '-' &&
      !page.username && !page.password && !page.port &&
      routes.every(route => !route.startsWith('/avatar-overlay')) &&
      ws.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(ws.hostname) &&
      Number(ws.port) === port && !ws.username && !ws.password && !ws.search && !ws.hash &&
      /^[a-zA-Z0-9_-]+$/.test(target.id) && ws.pathname === `/devtools/page/${target.id}`;
  } catch { return false; }
}

export async function discoverTargets(port, changed = () => {}) {
  // 调用前已核对端口身份；稳定连接内直接订阅窗口事件，不轮询进程和 HTTP 窗口列表。
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2500), redirect: 'error' });
  if (!response.ok) throw new Error(`读取连接信息失败：${response.status}`);
  const info = await response.json();
  const address = new URL(info.webSocketDebuggerUrl);
  if (address.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname) ||
      Number(address.port) !== port || address.username || address.password || address.search || address.hash ||
      !/^\/devtools\/browser\/[a-zA-Z0-9_-]+$/.test(address.pathname)) throw new Error('浏览器连接地址不是预期的本机端口。');
  const session = await new CDP(address.href).open();
  const pages = new Map();
  const update = ({ targetInfo }) => {
    const target = { ...targetInfo, id: targetInfo.targetId,
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${targetInfo.targetId}` };
    if (targetAllowed(target, port)) pages.set(target.id, target);
    else pages.delete(target.id);
    changed();
  };
  session.on('Target.targetCreated', update);
  session.on('Target.targetInfoChanged', update);
  session.on('Target.targetDestroyed', ({ targetId }) => { pages.delete(targetId); changed(); });
  session.ws.addEventListener('close', changed);
  try {
    await session.send('Target.setDiscoverTargets', { discover: true });
    return { session, pages };
  } catch (error) { session.close(); throw error; }
}

async function validateVideo(filename) {
  const resolved = await fs.realpath(filename);
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || stat.size < 16 || stat.size > 2 * 1024 ** 3 || path.extname(resolved).toLowerCase() !== '.mp4') {
    throw new Error('请选择一个非空、2 GB 以内的本地 MP4 文件。');
  }
  const file = await fs.open(resolved, 'r');
  try {
    const header = Buffer.alloc(128);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (!header.subarray(0, bytesRead).includes(Buffer.from('ftyp'))) throw new Error('文件头不是 MP4 容器。');
  } finally { await file.close(); }
  return resolved;
}

export async function resolveVideos(options) {
  const videos = [], unavailableVideos = [];
  let startIndex = 0;
  for (const [index, filename] of options.videos.entries()) {
    try {
      const video = await validateVideo(filename);
      if (index === options.startIndex) startIndex = videos.length;
      videos.push(video);
    } catch (error) {
      // 仅恢复旧记录时跳过已丢失的路径；新选择仍整体验证，避免悄悄改变用户选择。
      if (!options.restore || !['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      unavailableVideos.push(filename);
    }
  }
  const restoreWarning = unavailableVideos.length ? videos.length
    ? `上次列表中有 ${unavailableVideos.length} 个视频找不到了，暂时跳过；原记录保留。可用菜单 2 重新选择，菜单 5 查看详情。`
    : '上次的视频找不到了，请在菜单 2 重新选择；原记录保留。' : null;
  return { videos, startIndex, unavailableVideos, restoreWarning };
}

export async function main(args = process.argv.slice(2), { onStatus = () => {} } = {}) {
  const options = parseArgs(args);
  if (options.help) {
    console.log('用法：node wallpaper.mjs [视频.mp4] [--opacity 1] [--port 9463] [--check]\n默认显示视频原色。前台运行时：+ / - 调整不透明度，空格暂停/继续，q 或 Ctrl+C 关闭壁纸。');
    return;
  }
  if (process.platform !== 'darwin' || typeof WebSocket !== 'function') throw new Error('需要 macOS 和 Node.js 22 或更新版本。');
  let app = findCodexApp();
  const { videos, startIndex, unavailableVideos, restoreWarning } = await resolveVideos(options);
  options.startIndex = startIndex;
  const renderer = await fs.readFile(path.join(HERE, 'renderer.js'), 'utf8');
  if (!options.check) {
    ensureDataDir();
    logFile = LOG;
    writeFileSync(logFile, '');
  }
  log(`客户端版本：${app.version}；最低支持基线：26.915.31945。`);
  if (videos.length) {
    log(`本地视频${videos.length > 1 ? `列表（${videos.length} 个，顺序轮播）` : ''}：${videos.join('、')}`);
    log(`视频不透明度：${Math.round(options.opacity * 100)}%${options.opacity === 1 ? '（原色，不与界面底色混合）' : '（与界面底色混合）'}。`);
  } else log('未选择视频，连接后可在菜单中选择。');
  if (restoreWarning) log(restoreWarning, 'warning');
  if (options.check) {
    new Function(`return ${renderer}`);
    log('文件与脚本检查通过。本次没有启动、重启或修改 Codex。');
    return;
  }
  const sessions = new Map();
  const owner = randomUUID();
  let stop = false;
  let paused = false;
  let opacity = options.opacity;
  let applied = false;
  let appliedAt = 0;
  let stabilityReported = false;
  let lastError = '';
  let connectionConfirmed = false;
  let everConnected = false;
  let firstFrameDeadline = 0;
  let appearance = readAppearance();
  let previousClientVersion = readPreferences().lastConnectedVersion || null;
  let clientUpdated = Boolean(previousClientVersion && previousClientVersion !== app.version);
  let nextAppCheck = 0;
  let lostAt = null;
  let discovery;
  let wake = () => {};
  let appearanceDirty = false;
  const waitForWork = () => new Promise(resolve => {
    const done = () => { clearTimeout(timer); wake = () => {}; resolve(); };
    const timer = setTimeout(done, 3000);
    wake = done;
  });
  const settingsWatcher = watch(DATA_DIR, { persistent: false }, (_event, filename) => {
    if (String(filename) === path.basename(SETTINGS)) { appearanceDirty = true; wake(); }
  });
  const publish = (phase, extra = {}) => onStatus({
    phase, connected: phase === 'playing' || phase === 'connected', error: null, needsRestart: phase === 'waiting-for-exit',
    clientVersion: app.version, appBundle: app.bundle, appName: app.name, previousClientVersion, clientUpdated,
    video: videos[options.startIndex] ?? null, videos, playlistIndex: options.startIndex, loading: false, warning: null,
    restore: options.restore, unavailableVideos, restoreWarning,
    opacity, port: options.port, paused, appearance, updatedAt: Date.now(), ...extra,
  });
  const confirmConnection = () => {
    if (connectionConfirmed) return;
    log(`连接成功：Codex ${app.version} · 端口 ${options.port} · ${videos.length ? '视频已加载' : '未选择视频，可进入菜单选择'}。`, 'success');
    connectionConfirmed = true;
    everConnected = true;
    const preferences = readPreferences();
    if (preferences.lastConnectedVersion !== app.version) writePreferences({ ...preferences, lastConnectedVersion: app.version });
    previousClientVersion = app.version;
    clientUpdated = false;
  };
  const refreshApp = () => {
    if (Date.now() >= nextAppCheck) {
      nextAppCheck = Date.now() + 5000;
      const next = findCodexApp();
      if (next.version !== app.version) {
        previousClientVersion = app.version;
        clientUpdated = true;
        connectionConfirmed = false;
        firstFrameDeadline = Date.now() + 45000;
        log(`检测到 Codex 版本变化：${app.version} → ${next.version}，正在重新检查连接。`, 'warning');
        app = next;
        publish('reconnecting');
      }
      app = next;
    }
    return app;
  };
  const connect = async () => {
    let lastPhase = '';
    return connectApp({ getApp: refreshApp, port: options.port, stopped: () => stop, onState: phase => {
      publish(phase);
      if (phase !== lastPhase) {
        log(phase === 'waiting-for-exit'
          ? `尚未连接：Codex 没有开放端口 ${options.port}。重新运行连接命令可直接处理重启需求，或用 ⌘Q 完全退出后等待自动重开。`
          : `正在等待 Codex 开放端口 ${options.port}，尚未确认连接成功。`, 'warning');
        lastPhase = phase;
      }
    } });
  };
  const requestStop = () => { stop = true; wake(); };
  const requestPause = () => { paused = true; wake(); log('已请求暂停视频。'); };
  const requestResume = () => { paused = false; wake(); log('已请求继续播放。'); };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, requestStop);
  // 只由核对过进程身份的本地控制台发信号，不需要新增网络端口。
  process.on('SIGUSR1', requestPause);
  process.on('SIGUSR2', requestResume);
  publish('connecting');
  if (clientUpdated) log(`检测到 Codex 版本变化：${previousClientVersion} → ${app.version}，正在建立新连接。`, 'warning');
  if (process.stdin.isTTY) {
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', (text, key) => {
      if (text === 'q' || key?.ctrl && key.name === 'c') stop = true;
      else if (key?.name === 'space') { paused = !paused; log(paused ? '已暂停。' : '继续播放。'); }
      else if (text === '+' || text === '=' || text === '-') {
        opacity = Math.max(0, Math.min(1, opacity + (text === '-' ? -0.05 : 0.05)));
        log(`视频强度：${Math.round(opacity * 100)}%`);
      }
      wake();
    });
  }
  try {
    firstFrameDeadline = Date.now() + 45000;
    while (!stop) {
      try {
        if (!discovery || discovery.session.ws.readyState !== WebSocket.OPEN) {
          publish('reconnecting');
          if (connectionConfirmed) firstFrameDeadline = Date.now() + 45000;
          connectionConfirmed = false;
          for (const item of sessions.values()) item.session.close();
          sessions.clear();
          discovery?.session.close();
          discovery = null;
          refreshApp();
          lostAt ??= Date.now();
          // 给更新程序的快速重开留出时间；普通退出不会被后台强行拉起。
          if (everConnected && !running(app) && !clientUpdated) {
            if (Date.now() - lostAt >= 5000) { log('Codex 已退出，壁纸后台结束。'); break; }
            await sleep(500);
            continue;
          }
          if (!await connect()) break;
          discovery = await discoverTargets(options.port, () => wake());
          log(videos.length ? '端口已接入，正在等待主窗口和视频加载确认。' : '端口已接入，正在等待主窗口连接确认。', 'warning');
          firstFrameDeadline = Date.now() + 45000;
        }
        lostAt = null;
        if (appearanceDirty) { appearance = readAppearance(); appearanceDirty = false; }
        const pages = [...discovery.pages.values()];
        const activeIds = new Set(pages.map(page => page.id));
        for (const [id, item] of sessions) if (!activeIds.has(id)) { item.session.close(); sessions.delete(id); }
        let frameObserved = false;
        for (const page of pages) {
          if (stop) break;
          let item = sessions.get(page.id);
          if (!item) {
            item = { session: await new CDP(page.webSocketDebuggerUrl).open(), time: 0, index: options.startIndex };
            sessions.set(page.id, item);
          }
          const result = await attachVideo(item.session, renderer, videos, { owner, opacity, paused, appearance, resumeTime: item.time, resumeIndex: item.index });
          if (result?.state === 'busy') throw new Error('另一个视频壁纸脚本正在控制此窗口，请先关闭它。');
          if (result?.state === 'error') throw new Error(result.error);
          if (result?.state === 'connected' && !videos.length) {
            frameObserved = true;
            publish('connected', { requestedPause: false });
            confirmConnection();
          }
          if (result?.state === 'loading' && connectionConfirmed) {
            frameObserved = true;
            publish('loading-video', { connected: true, loading: true, playlistIndex: result.playlistIndex,
              video: videos[result.playlistIndex], requestedPause: paused, warning: result.warning });
          }
          if (result?.state === 'playing' && result.ready >= 2) {
            frameObserved = true;
            item.time = result.time;
            item.index = result.playlistIndex ?? 0;
            publish('playing', { paused: result.paused, requestedPause: paused, time: result.time,
              width: result.width, height: result.height, appearance: result.appearance,
              playlistIndex: item.index, video: videos[item.index], loading: false, warning: result.warning });
            if (result.warning && result.warning !== item.warning) log(result.warning, 'warning');
            item.warning = result.warning;
            confirmConnection();
            if (!applied) {
              log(`视频已加载：${result.width} × ${result.height}。`);
              if (appearance.mode === 'fixed') {
                log(`阅读外观已启用：文字 ${appearance.color}，局部玻璃底色 ${Math.round(appearance.glass * 100)}%。`);
              } else if (result.contrast) {
                const tone = value => value === 'dark' ? '深色文字' : '浅色文字';
                log(`自动文字对比已启用：内容区${tone(result.contrast.content.text)}，左栏${tone(result.contrast.sidebar.text)}；随视频明暗调整。`);
              }
              applied = true;
              appliedAt = Date.now();
            }
            if (!stabilityReported && Date.now() - appliedAt >= 30000 && !result.paused && result.time > 0) {
              log('视频背景已保持运行超过 30 秒，连接检查正常。');
              stabilityReported = true;
            }
          }
        }
        if (!frameObserved) {
          if (connectionConfirmed) firstFrameDeadline = Date.now() + 45000;
          connectionConfirmed = false;
          publish('connecting');
        }
        lastError = '';
      } catch (error) {
        publish('reconnecting', { error: error.message });
        if (connectionConfirmed) firstFrameDeadline = Date.now() + 45000;
        connectionConfirmed = false;
        if (error.message !== lastError) { log(error.message, 'error'); lastError = error.message; }
        if (lastError.includes('另一个视频') || lastError.includes('解码失败') || lastError.includes('均无法播放')) throw error;
        for (const [id, item] of sessions) {
          if (item.session.ws.readyState !== WebSocket.OPEN) { item.session.close(); sessions.delete(id); }
        }
      }
      if (!connectionConfirmed && Date.now() > firstFrameDeadline) throw new Error(videos.length
        ? '未找到可应用的主窗口，或视频尚未成功播放。请查看上面的错误。'
        : '未收到 CodeX 主窗口连接确认，请查看上面的错误。');
      await waitForWork();
    }
  } finally {
    publish('stopping');
    settingsWatcher.close();
    wake();
    process.removeListener('SIGUSR1', requestPause);
    process.removeListener('SIGUSR2', requestResume);
    await Promise.allSettled([...sessions.values()].map(async item => {
      try { await removeVideo(item.session, owner); } finally { item.session.close(); }
    }));
    discovery?.session.close();
    if (process.stdin.isTTY) {
      // 终端窗口已关闭时 setRawMode 可能返回 EIO，不应影响视频清理。
      try { process.stdin.setRawMode(false); } catch {}
      process.stdin.pause();
    }
    if (applied) log('已移除视频层并恢复原背景。普通启动 Codex 可同时关闭本次调试端口。');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // 清理已经由 main 的 finally 完成；明确退出，避免旧终端/连接句柄残留。
  main().then(() => process.exit(0), error => {
    log(error.message, 'error');
    process.exit(1);
  });
}
