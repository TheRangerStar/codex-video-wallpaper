import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { readAppearance, normalizeAppearance, readPreferences, writePreferences } from './appearance.mjs';
import { paint, connectionMessage } from './terminal-output.mjs';
import { STATE, LOG, ensureDataDir, isManagedWorker } from './storage.mjs';

const SCRIPT = fileURLToPath(import.meta.url);
const HERE = path.dirname(SCRIPT);
const TAG = '[CodeX视频壁纸]';
const say = (text, level = 'info') => console.log(paint(`${TAG} ${text}`, level));

function inspect(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  try {
    return {
      command: execFileSync('/bin/ps', ['-ww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim(),
      started: execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim(),
    };
  } catch { return null; }
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return null; }
}

function owned(record) {
  if (!record || typeof record.token !== 'string' || !/^[a-f0-9-]{36}$/.test(record.token)) return false;
  if (!isManagedWorker(record.script, SCRIPT) || typeof record.command !== 'string' || typeof record.node !== 'string' ||
      !record.command.startsWith(`${record.node} ${record.script} --worker ${record.token}`)) return false;
  const live = inspect(record.pid);
  return live?.command === record.command && live?.started === record.started;
}

function removeOwnState(token) {
  const record = readState();
  if (record?.token === token && record.phase !== 'error') fs.rmSync(STATE, { force: true });
}

export function status() {
  const record = readState();
  if (!owned(record)) return record?.script === SCRIPT && record.phase === 'error'
    ? { running: false, phase: 'error', connected: false, error: record.error, clientVersion: record.clientVersion, port: record.port }
    : { running: false, phase: 'stopped' };
  const age = Date.now() - record.updatedAt;
  if (['connected', 'playing', 'loading-video'].includes(record.phase) && (record.connected !== true || !Number.isFinite(age) || age < 0 || age > 10000)) {
    return { ...record, running: true, connected: false, phase: 'reconnecting', error: null };
  }
  return { running: true, ...record };
}

function updateState(token, details) {
  const record = readState();
  if (record?.token !== token) return;
  const temporary = `${STATE}.${token}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ ...record, controlVersion: 6, ...details }), { mode: 0o600 });
  fs.renameSync(temporary, STATE);
}

function argumentsFor(settings) {
  return [...(Array.isArray(settings.videos) ? settings.videos : settings.video ? [settings.video] : []),
    '--opacity', String(settings.opacity ?? 1), '--port', String(settings.port ?? 9463),
    ...(settings.restore ? ['--restore'] : []),
    ...(settings.playlistIndex ? ['--start-index', String(settings.playlistIndex)] : [])];
}

function savedArguments() {
  return argumentsFor({ ...readPreferences(), restore: true });
}

function saveSettings(record) {
  const videos = record.videos?.length ? record.videos : [record.video];
  writePreferences({ ...readPreferences(), video: videos[0], videos, opacity: record.opacity, port: record.port });
}

export const getAppearance = readAppearance;

export async function setAppearance(patch) {
  // 验证所有字段后再写入，颜色不能成为任意 CSS，更新保留已选视频。
  normalizeAppearance(patch);
  const preferences = readPreferences();
  const appearance = normalizeAppearance({ ...normalizeAppearance(preferences.appearance), ...patch });
  writePreferences({ ...preferences, appearance });
  const record = status();
  if (!record.running || record.phase !== 'playing' || !record.appearance) {
    say('外观已保存，将在视频壁纸播放时生效。', 'warning');
    return appearance;
  }
  for (let i = 0; i < 80; i++) {
    const current = status();
    if (current.running && current.phase === 'playing' && JSON.stringify(current.appearance) === JSON.stringify(appearance)) {
      say('外观已实时应用并保存。', 'success');
      return appearance;
    }
    if (!current.running) break;
    await sleep(100);
  }
  throw new Error('外观已保存，暂未收到窗口确认；连接恢复后会自动应用。');
}

function checkArguments(args) {
  try {
    execFileSync(process.execPath, [path.join(HERE, 'wallpaper.mjs'), ...args, '--check'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error(String(error.stderr || error.stdout || '视频或参数检查失败。').trim());
  }
}

function claim(token) {
  const identity = inspect(process.pid);
  if (!identity) throw new Error('无法读取进程身份，未启动壁纸；请直接打开启动应用。');
  const record = { pid: process.pid, token, script: SCRIPT, node: process.execPath, ...identity };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(STATE, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = readState();
      if (owned(previous)) return false;
      let stat;
      try { stat = fs.statSync(STATE); } catch { continue; }
      // 刚创建而尚未写完的记录属于其他启动者；只回收过期记录。
      if (!previous && Date.now() - stat.mtimeMs < 5000) return false;
      if (fs.statSync(STATE).ino === stat.ino) fs.rmSync(STATE, { force: true });
    }
  }
  return false;
}

async function worker(token, args) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error('后台启动标识无效。');
  if (!claim(token)) return;
  process.on('exit', () => removeOwnState(token));
  try {
    const { main } = await import('./wallpaper.mjs');
    await main(args, { onStatus: details => updateState(token, details) });
  } catch (error) {
    updateState(token, { phase: 'error', connected: false, error: error.message, updatedAt: Date.now() });
    throw error;
  } finally { removeOwnState(token); }
}

export async function start(args = savedArguments()) {
  ensureDataDir();
  // 已存在的旧后台也升级状态协议，防止继续显示旧的连接结果。
  const existing = readState();
  if (owned(existing) && (existing.script !== SCRIPT || [1, 2, 3, 4, 5].includes(existing.controlVersion))) await stop();
  if (owned(readState())) {
    say('后台已在运行，正在重新确认 Codex 连接。', 'warning');
    return;
  }
  // 启动前先完成只读检查，使参数和视频错误可以立即反馈给启动者。
  checkArguments(args);
  const token = randomUUID();
  const child = spawn(process.execPath, [SCRIPT, '--worker', token, ...args], {
    cwd: HERE, detached: true, stdio: 'ignore',
  });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  child.unref();
  for (let i = 0; i < 30; i++) {
    if (spawnError) throw spawnError;
    if (owned(readState())) {
      say('连接进程已启动，正在检查 Codex；此时尚未确认连接成功。', 'warning');
      return;
    }
    await sleep(100);
  }
  throw new Error(`后台进程未能持续运行，请查看：${LOG}`);
}

export async function stop() {
  const record = readState();
  if (!owned(record)) {
    if (record?.script === SCRIPT && record.phase === 'error') fs.rmSync(STATE, { force: true });
    say('没有正在运行的本目录壁纸进程。'); return;
  }
  // 发信号前再次核对 PID、启动时间、脚本路径和随机标识，避免命中复用 PID。
  if (!owned(record)) return;
  process.kill(record.pid, 'SIGTERM');
  for (let i = 0; i < 300; i++) {
    if (!owned(record)) { removeOwnState(record.token); say('视频壁纸已关闭，原背景已恢复。'); return; }
    await sleep(100);
  }
  throw new Error('已通知壁纸退出，仍在等待窗口清理；没有强制结束其他进程。请稍后查看运行日志。');
}

export async function waitForPlayback(timeout = 45000, { allowWaiting = true, allowConnected = false, after } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const record = status();
    if (!record.running) {
      if (record.error) throw new Error(`壁纸后台已退出。\n${record.error}`);
      const detail = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').at(-1) : '';
      throw new Error(`壁纸后台已退出。${detail ? `\n${detail}` : ''}`);
    }
    const fresh = after === undefined || record.updatedAt > after;
    if (fresh && ((record.phase === 'playing' || allowConnected && record.phase === 'connected') && record.connected === true
      || allowWaiting && record.phase === 'waiting-for-exit')) return record;
    await sleep(250);
  }
  throw new Error('连接仍未完成，请稍后查看状态。');
}

export async function reconnect({ restart = false } = {}) {
  const requestedAt = Date.now();
  await start();
  // 每次进入控制台都等待本次请求后的回报，不沿用上一次连接成功的记录。
  const current = await waitForPlayback(45000, { allowConnected: true, after: requestedAt });
  if (current.phase !== 'waiting-for-exit' || !restart) return current;
  const { requestAppQuit } = await import('./wallpaper.mjs');
  // 仅由用户在连接提示中明确确认后调用；后台从不擅自结束 Codex。
  await requestAppQuit();
  return waitForPlayback(45000, { allowWaiting: false, allowConnected: true, after: Date.now() });
}

export async function setPaused(paused) {
  const record = status();
  if (!record.running || record.phase !== 'playing' || !record.controlVersion) {
    throw new Error('请先启用壁纸并等待视频加载完成。');
  }
  if (!owned(record)) throw new Error('壁纸进程已变化，请重新连接。');
  process.kill(record.pid, paused ? 'SIGUSR1' : 'SIGUSR2');
  for (let i = 0; i < 80; i++) {
    const current = status();
    if (current.token !== record.token) throw new Error('壁纸已退出或重新启动。');
    if (current.updatedAt > record.updatedAt && current.requestedPause === paused) {
      say(paused ? '视频已暂停。' : '视频已继续播放。', 'success');
      return current;
    }
    await sleep(100);
  }
  throw new Error('已发出控制请求，但暂未收到窗口确认，请查看状态。');
}

export async function changeVideo(filename) {
  const previous = status();
  const { parseArgs } = await import('./wallpaper.mjs');
  const defaults = parseArgs(savedArguments());
  const selected = Array.isArray(filename) ? filename : [filename];
  if (!selected.length || selected.some(value => typeof value !== 'string' || !value.trim())) throw new Error('请至少选择一个有效的视频路径。');
  const videos = [...new Set(selected.map(value => path.resolve(value)))];
  const next = { video: videos[0], videos, opacity: previous.opacity ?? defaults.opacity, port: previous.port ?? defaults.port };
  // 文件和容器检查先于停止旧视频；非法路径不会中断正在播放的壁纸。
  checkArguments(argumentsFor(next));
  await stop();
  try {
    await start(argumentsFor(next));
    const current = await waitForPlayback();
    if (previous.requestedPause && current.phase === 'playing') await setPaused(true);
    saveSettings(current);
    say(current.phase === 'playing' ? `视频已更换，并记住了这次选择${videos.length > 1 ? `（${videos.length} 个视频顺序轮播）` : ''}。` : '已记住视频选择，但尚未连接 Codex；需要退出重开。', current.phase === 'playing' ? 'success' : 'warning');
    return status();
  } catch (error) {
    await stop();
    if (previous.running) {
      try {
        await start(argumentsFor(previous));
        const restored = await waitForPlayback(45000, { allowConnected: true });
        if (previous.requestedPause && restored.phase === 'playing') await setPaused(true);
      } catch (restoreError) {
        throw new Error(`新视频加载失败，恢复之前的视频也未完成：${restoreError.message}`);
      }
      throw new Error(`新视频未能加载，${previous.video ? '已恢复之前的视频' : '已恢复连接，请在菜单中重新选择视频'}。\n${error.message}`);
    }
    throw error;
  }
}

async function main(args) {
  if (!inspect(process.pid)) throw new Error('无法读取进程身份，未启动或停止任何壁纸进程；请直接打开启动或关闭应用。');
  const [action = 'start', ...rest] = args;
  if (action === '--worker') return worker(rest[0], rest.slice(1));
  if (action === 'start') return rest.length ? start(rest) : start();
  if (action === 'stop') return stop();
  if (action === 'status') { const message = connectionMessage(status()); say(message.text, message.level); return; }
  if (action === 'pause') return setPaused(true);
  if (action === 'resume') return setPaused(false);
  if (action === 'change' && rest.length) return changeVideo(rest);
  throw new Error('用法：node background.mjs start [视频.mp4] [--opacity 1]，或 stop / status / pause / resume / change 视频.mp4。');
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) main(process.argv.slice(2)).then(() => process.exit(0), error => {
  const text = `${TAG} ${error.message}`;
  console.error(paint(text, 'error', process.stderr));
  if (process.argv[2] === '--worker') {
    try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${text}\n`); } catch {}
  }
  process.exit(1);
});
