import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { SETTINGS, ensureDataDir } from './storage.mjs';
export const DEFAULT_APPEARANCE = Object.freeze({ mode: 'fixed', color: '#fff4e6', shadow: 'soft', glass: 0.28 });

export function normalizeAppearance(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !Object.hasOwn(DEFAULT_APPEARANCE, key))) throw new Error('外观设置格式无效。');
  const result = { ...DEFAULT_APPEARANCE, ...value };
  if (!['auto', 'fixed'].includes(result.mode)) throw new Error('文字模式应为自动或固定颜色。');
  if (typeof result.color !== 'string' || !/^#[\da-f]{6}$/i.test(result.color)) throw new Error('颜色请输入六位十六进制值，例如 #fff4e6。');
  if (!['none', 'soft', 'strong'].includes(result.shadow)) throw new Error('请选择关闭、轻微或较强阴影。');
  if (typeof result.glass !== 'number' || !Number.isFinite(result.glass) || result.glass < 0 || result.glass > 0.6) {
    throw new Error('局部玻璃底色强度应在 0% 到 60% 之间。');
  }
  return { ...result, color: result.color.toLowerCase() };
}

export function readPreferences() {
  try {
    const value = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设置格式无效');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error('无法读取本地设置文件，原文件已保留。');
  }
}

export function writePreferences(value) {
  ensureDataDir();
  const temporary = `${SETTINGS}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, SETTINGS);
  } finally { fs.rmSync(temporary, { force: true }); }
}

export function readAppearance() {
  return normalizeAppearance(readPreferences().appearance);
}
