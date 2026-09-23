import { createInterface } from 'node:readline/promises';
import { clearLine, cursorTo } from 'node:readline';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as background from './background.mjs';
import { paint, connectionMessage } from './terminal-output.mjs';

const exec = promisify(execFile);
const TAG = '[CodeX视频壁纸]';

export async function chooseVideo({ multiple = false } = {}, execute = exec) {
  const script = `function run() {
    var app = Application.currentApplication();
    app.includeStandardAdditions = true;
    try {
      var selected = app.chooseFile({
        withPrompt: ${JSON.stringify(multiple ? '选择用于顺序轮播的 MP4 视频（可多选）' : '选择用作 Codex 背景的 MP4 视频')},
        ofType: ['public.mpeg-4'], multipleSelectionsAllowed: ${multiple ? 'true' : 'false'}
      });
      return JSON.stringify(${multiple ? '(Array.isArray(selected) ? selected : [selected]).map(String)' : 'String(selected)'});
    } catch (error) {
      if (error.errorNumber === -128 || error.number === -128) return 'null';
      throw error;
    }
  }`;
  try {
    // 用 JSON 接收路径，避免多选时把文件名里的换行误当成文件分隔符。
    const { stdout } = await execute('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    const selection = JSON.parse(stdout);
    if (selection === null) return null;
    if (multiple && Array.isArray(selection) && selection.every(item => typeof item === 'string' && item.length)) {
      return selection.length ? selection : null;
    }
    if (!multiple && typeof selection === 'string' && selection.length) return selection;
    throw new Error('视频选择结果格式不正确。');
  } catch (error) {
    if (String(error.stderr).includes('(-128)')) return null;
    throw new Error('无法打开视频选择器，请检查 macOS 的提示后重试。');
  }
}

export function describe(state) {
  return connectionMessage(state).text;
}

async function appearanceMenu({ ask, write, control, isClosed }) {
  const shadowNames = { none: '无', soft: '轻微', strong: '明显' };
  const apply = async patch => {
    await control.setAppearance(patch);
    const state = control.status();
    const applied = state.phase === 'playing' && connectionMessage(state).level === 'success';
    write(applied ? '外观已保存并应用。' : '外观已保存；播放视频时生效。', applied ? 'success' : 'warning');
  };
  while (!isClosed()) {
    const appearance = control.getAppearance();
    const textColor = appearance.mode === 'auto' ? '自动（暗背景浅字，亮背景深字）' : appearance.color;
    write(`\n外观设置 · 文字 ${textColor} · 阴影 ${shadowNames[appearance.shadow]} · 基础玻璃 ${Math.round(appearance.glass * 100)}%`);
    write('左栏与内容区使用相同基础玻璃；设置页和输入框额外加强底色对比，视频原色与模糊程度保持不变。');
    write('\n1. 应用推荐效果（暖白字＋轻微阴影＋28% 深色玻璃）\n2. 设置文字颜色\n3. 设置文字阴影\n4. 设置局部玻璃强度\n0. 返回主菜单\n');
    const choice = await ask('外观编号：');
    if (choice === null || choice === '0') return;
    try {
      if (choice === '1') {
        await apply({ mode: 'fixed', color: '#fff4e6', shadow: 'soft', glass: 0.28 });
      } else if (choice === '2') {
        write('\n1. 自动\n2. 纯白\n3. 暖白\n4. 深色\n5. 自选颜色（十六进制）\n0. 返回\n');
        const colorChoice = await ask('文字颜色编号：');
        if (colorChoice === null) return;
        if (colorChoice === '0') continue;
        if (colorChoice === '1') await apply({ mode: 'auto' });
        else if (['2', '3', '4'].includes(colorChoice)) {
          await apply({ mode: 'fixed', color: { 2: '#ffffff', 3: '#fff4e6', 4: '#18202a' }[colorChoice] });
        } else if (colorChoice === '5') {
          const color = await ask('输入 6 位颜色，例如 #dcecff（直接回车取消）：');
          if (color === null) return;
          if (!color) { write('已取消，保留当前颜色。', 'warning'); continue; }
          if (!/^#?[0-9a-f]{6}$/i.test(color)) { write('颜色格式不正确，请使用 6 位十六进制颜色，例如 #dcecff。', 'warning'); continue; }
          await apply({ mode: 'fixed', color: `#${color.replace(/^#/, '').toLowerCase()}` });
        } else write('请输入 0 到 5 之间的编号。', 'warning');
      } else if (choice === '3') {
        write('\n1. 无阴影\n2. 轻微阴影\n3. 明显阴影\n0. 返回\n');
        const shadowChoice = await ask('文字阴影编号：');
        if (shadowChoice === null) return;
        if (shadowChoice === '0') continue;
        const shadow = ['1', '2', '3'].includes(shadowChoice) ? { 1: 'none', 2: 'soft', 3: 'strong' }[shadowChoice] : null;
        if (shadow) await apply({ shadow });
        else write('请输入 0 到 3 之间的编号。', 'warning');
      } else if (choice === '4') {
        const strength = await ask('局部玻璃强度 0–60%，数值越大底色越明显（直接回车取消）：');
        if (strength === null) return;
        if (!strength) { write('已取消，保留当前玻璃强度。', 'warning'); continue; }
        if (!/^\d+(?:\.\d+)?$/.test(strength) || Number(strength) > 60) {
          write('请输入 0 到 60 之间的数字。', 'warning'); continue;
        }
        await apply({ glass: Number(strength) / 100 });
      } else write('请输入 0 到 4 之间的编号。', 'warning');
    } catch (error) { write(`${TAG} ${error.message}`, 'error'); }
  }
}

export async function runConsole({ input = process.stdin, output = process.stdout,
  control = background, picker = chooseVideo, hostName = os.hostname().replace(/\.local$/i, '') } = {}) {
  const write = (text, level = 'info') => output.write(`${paint(text, level, output)}\n`);
  if (!input.isTTY) throw new Error('请在终端中运行 codex-wallpaper。');
  const reader = createInterface({ input, output });
  let closed = false;
  const pending = new AbortController();
  reader.on('close', () => { closed = true; pending.abort(); });
  reader.on('SIGINT', () => reader.close());
  const displayPath = filename => /[\x00-\x1f\x7f]/.test(filename) ? JSON.stringify(filename) : filename;
  const showConnection = (state, { details = false } = {}) => {
    if (details && state.clientVersion) write(`Codex ${state.clientVersion} · 本机端口 ${state.port ?? 9463}`);
    if (details && state.appBundle) write(`应用位置：${displayPath(state.appBundle)}`);
    if (state.clientUpdated) write(`检测到版本变化：${state.previousClientVersion} → ${state.clientVersion}`, 'warning');
    const message = connectionMessage(state);
    write(message.text, message.level);
    if (state.loading) write('正在加载下一个视频…', 'warning');
    if (state.warning) write(state.warning, 'warning');
    if (state.restoreWarning) write(state.restoreWarning, 'warning');
  };
  const showVideos = (state, { list = false } = {}) => {
    const videos = state.videos?.length ? state.videos : state.video ? [state.video] : [];
    if (!videos.length) { write('当前视频：未选择视频'); return; }
    const index = Number.isInteger(state.playlistIndex) && state.playlistIndex >= 0 && state.playlistIndex < videos.length
      ? state.playlistIndex : Math.max(0, videos.indexOf(state.video));
    // JSON 转义控制字符，路径中的换行不会扰乱终端布局。
    write(`当前视频：第 ${index + 1}/${videos.length} 个 · ${displayPath(path.basename(state.video || videos[index]))}`);
    if (list) videos.forEach((filename, item) => write(`  ${item + 1}. ${displayPath(filename)}${item === index ? ' ← 当前' : ''}`));
  };
  const showDetails = state => {
    write('\n连接详情');
    showConnection(state, { details: true });
    showVideos(state, { list: true });
    if (state.unavailableVideos?.length) {
      write('找不到的原视频（记录仍保留）：', 'warning');
      state.unavailableVideos.forEach((filename, index) => write(`  ${index + 1}. ${displayPath(filename)}`, 'warning'));
    }
  };
  const statusKey = state => JSON.stringify([state.running, state.phase, state.connected, state.clientVersion,
    state.clientUpdated, state.error, state.paused, state.requestedPause, state.video, state.videos,
    state.playlistIndex, state.loading, state.warning, state.restoreWarning, state.unavailableVideos]);
  const ask = async (prompt, { live = false } = {}) => {
    if (closed) return null;
    let previous = live ? statusKey(control.status()) : null;
    const timer = live ? setInterval(() => {
      if (closed) return;
      try {
        const state = control.status();
        const next = statusKey(state);
        if (next === previous) return;
        previous = next;
        if (output.isTTY) { cursorTo(output, 0); clearLine(output, 0); }
        else write('');
        showConnection(state);
        showVideos(state);
        // 使用 readline 的公开接口重画提示，保留用户已经输入的编号。
        reader.prompt(true);
      } catch (error) { write(`${TAG} ${error.message}`, 'error'); }
    }, 1000) : null;
    try { return (await reader.question(prompt, { signal: pending.signal })).trim(); }
    catch (error) { if (closed) return null; throw error; }
    finally { if (timer) clearInterval(timer); }
  };
  const connect = async () => {
    write('正在连接…尚未确认成功。', 'warning');
    let current;
    if (control.reconnect) current = await control.reconnect();
    else {
      await control.start();
      current = await control.waitForPlayback() || control.status();
    }
    if (closed) return false;
    if (current.phase === 'waiting-for-exit') {
      showConnection(current);
      write('需要重新打开 Codex 才能建立连接。请先结束正在运行的任务。', 'warning');
      const answer = await ask('确认重启 Codex？输入 R 重启，其他键取消：');
      if (answer?.toLowerCase() !== 'r') {
        write('未重启；后台仍会等待你手动退出 Codex。', 'warning');
        return false;
      }
      if (!control.reconnect) throw new Error('当前后台不支持重连操作，请更新脚本。');
      write('正在重启并连接，收到窗口连接确认后才会显示成功。', 'warning');
      current = await control.reconnect({ restart: true });
    }
    if (!['connected', 'playing'].includes(current.phase) || current.connected !== true) {
      throw new Error(current.error || '尚未收到窗口连接确认，请重新运行连接命令。');
    }
    return !closed;
  };
  write('\nCodeX视频壁纸');
  write(`本机：${JSON.stringify(hostName)} · 自动连接`);
  try {
    try {
      if (!await connect()) return 0;
    } catch (error) { write(`${TAG} ${error.message}`, 'error'); return 1; }
    while (!closed) {
      const state = control.status();
      write('');
      showConnection(state);
      showVideos(state);
      write(`\n1. 启用视频壁纸\n2. ${state.video || state.videos?.length ? '更换' : '选择'}视频（单选循环 / 多选轮播）`);
      write(`3. ${state.requestedPause ? '继续' : '暂停'}视频`);
      write('4. 关闭壁纸\n5. 查看连接状态\n6. 外观设置\n7. 重新连接（需要时重启 Codex）\n0. 退出菜单（壁纸继续后台运行）\n');
      const choice = await ask('输入编号并回车：', { live: true });
      if (choice === null || choice === '0') break;
      try {
        if (choice === '1' || choice === '7') {
          if (await connect() && control.status().phase === 'connected') write('尚未选择视频，请选择菜单 2。', 'warning');
        } else if (choice === '2') {
          write('\n1. 单选视频，循环播放\n2. 多选视频，按列表顺序轮播\n0. 返回主菜单\n');
          const mode = await ask('视频选择方式：');
          if (mode === null || mode === '0') continue;
          if (!['1', '2'].includes(mode)) { write('请输入 0 到 2 之间的编号。', 'warning'); continue; }
          const selection = await picker({ multiple: mode === '2' });
          if (closed) continue;
          if (!selection || Array.isArray(selection) && !selection.length) {
            write(state.video || state.videos?.length ? '已取消，继续使用原视频。' : '已取消，尚未选择视频。', 'warning'); continue;
          }
          const videos = Array.isArray(selection) ? selection : [selection];
          write(videos.length > 1 ? '轮播顺序（播放完最后一个后回到第一个）：' : '已选择视频：');
          videos.forEach((filename, index) => write(`  ${index + 1}. ${JSON.stringify(filename)}`));
          await control.changeVideo(selection);
        } else if (choice === '3') {
          const current = control.status();
          if (current.phase === 'connected') write('尚未选择视频，请选择菜单 2。', 'warning');
          else await control.setPaused(!current.requestedPause);
        } else if (choice === '4') {
          await control.stop();
        } else if (choice === '6') {
          await appearanceMenu({ ask, write, control, isClosed: () => closed });
        } else if (choice === '5') showDetails(control.status());
        else write('请输入 0 到 7 之间的编号。', 'warning');
      } catch (error) { write(`${TAG} ${error.message}`, 'error'); }
    }
    return 0;
  } finally {
    reader.close();
    write('\n已退出控制台，后台壁纸保持原状态。');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runConsole().then(code => { process.exitCode = code ?? 0; }).catch(error => { console.error(paint(`${TAG} ${error.message}`, 'error', process.stderr)); process.exitCode = 1; });
}
