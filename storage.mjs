import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Brew 入口指定固定用户目录；现有本地开发入口仍使用原目录。
export const DATA_DIR = process.env.CODEX_WALLPAPER_DATA_DIR
  ? path.resolve(process.env.CODEX_WALLPAPER_DATA_DIR)
  : path.dirname(fileURLToPath(import.meta.url));
export const SETTINGS = path.join(DATA_DIR, '.wallpaper-settings.json');
export const STATE = path.join(DATA_DIR, '.wallpaper-runtime.json');
export const LOG = path.join(DATA_DIR, '运行日志.txt');

export function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

export function isManagedWorker(script, currentScript, root = process.env.CODEX_WALLPAPER_INSTALL_ROOT) {
  if (script === currentScript) return true;
  if (!root || typeof script !== 'string' || !path.isAbsolute(root)) return false;
  const inPackage = filename => {
    if (path.resolve(filename) !== filename) return false;
    const parts = path.relative(root, filename).split(path.sep);
    return parts.length === 3 && /^\d+\.\d+\.\d+(?:_\d+)?$/.test(parts[0])
      && parts[1] === 'libexec' && parts[2] === 'background.mjs';
  };
  // 仅允许同一 Brew 包的历史版本；后续仍核对实际命令、启动时间和随机标识。
  return inPackage(currentScript) && inPackage(script);
}
