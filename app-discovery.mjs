import { accessSync, constants, readdirSync, realpathSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';

const BUNDLE_ID = 'com.openai.codex';

function run(file, args) {
  return execFileSync(file, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function attempt(read, fallback) {
  try { return read(); } catch { return fallback; }
}

const systemIO = {
  canonicalPath: realpathSync,
  runningExecutables: () => run('/bin/ps', ['-axo', 'comm=']).split('\n').map(line => line.trim()).filter(Boolean),
  applicationDirectories: () => ['/Applications', path.join(homedir(), 'Applications')],
  directoryBundles: directory => readdirSync(directory).filter(name => name.toLowerCase().endsWith('.app')).sort().map(name => path.join(directory, name)),
  registeredBundles: () => {
    // 只查询此 bundle ID，不导出整个 LaunchServices 注册表，也不会启动应用。
    const script = `ObjC.import('AppKit'); var u = $.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier('${BUNDLE_ID}'); JSON.stringify(u.isNil() ? [] : [ObjC.unwrap(u.path)]);`;
    return JSON.parse(run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script]));
  },
  indexedBundles: () => run('/usr/bin/mdfind', ['-0', `kMDItemCFBundleIdentifier == "${BUNDLE_ID}"`]).split('\0').filter(Boolean),
  readApp: bundle => {
    if (!statSync(bundle).isDirectory()) return null;
    const plist = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(bundle, 'Contents/Info.plist')]));
    if (plist.CFBundleIdentifier !== BUNDLE_ID) return null;
    const binary = plist.CFBundleExecutable;
    const version = plist.CFBundleShortVersionString;
    if (typeof binary !== 'string' || !binary || path.basename(binary) !== binary || typeof version !== 'string' || !version.trim()) return null;
    const executable = path.join(bundle, 'Contents/MacOS', binary);
    if (!statSync(executable).isFile()) return null;
    accessSync(executable, constants.X_OK);
    return { bundle, version, executable, name: path.basename(bundle, path.extname(bundle)) };
  },
};

// 查找只发生在连接流程；注入只读 I/O 用于验证，不维护轮询或跨次缓存。
export function findCodexApp(overrides = {}) {
  const io = { ...systemIO, ...overrides };
  const checked = new Map();
  const canonical = file => attempt(() => io.canonicalPath(file), file);
  const inspect = candidate => {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || !candidate.toLowerCase().endsWith('.app')) return null;
    const bundle = canonical(candidate);
    if (!checked.has(bundle)) checked.set(bundle, attempt(() => io.readApp(bundle), null));
    return checked.get(bundle);
  };
  const firstAvailable = candidates => {
    for (const candidate of candidates) {
      const app = inspect(candidate);
      if (app) return app;
    }
    return null;
  };

  // 优先同一台机器上已运行的主进程，避免连接时打开另一份安装。
  for (const executable of attempt(io.runningExecutables, [])) {
    const match = executable.match(/^(.*\.app)\/Contents\/MacOS\/[^/]+$/i);
    if (!match) continue;
    const app = inspect(match[1]);
    if (app && canonical(executable) === canonical(app.executable)) return app;
  }

  const directories = io.applicationDirectories();
  // 常见文件名先查；无关的 ChatGPT.app 不会阻断后续候选。
  let found = firstAvailable(directories.flatMap(directory => ['Codex.app', 'ChatGPT.app'].map(name => path.join(directory, name))));
  if (found) return found;
  for (const directory of directories) {
    found = firstAvailable(attempt(() => io.directoryBundles(directory), []));
    if (found) return found;
  }
  // 自定义安装位置通过系统登记和索引查找；过期记录逐个跳过。
  found = firstAvailable(attempt(io.registeredBundles, []));
  if (found) return found;
  found = firstAvailable(attempt(io.indexedBundles, []));
  if (found) return found;
  throw new Error('未找到可用的 CodeX 桌面客户端。请先安装 CodeX，或确认应用文件完整且仍在原位置。');
}
