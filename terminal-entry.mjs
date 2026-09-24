import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runConsole } from './console.mjs';
import { paint } from './terminal-output.mjs';

export const VERSION = '0.1.1';

export function localMachine() {
  const readName = key => {
    try { return execFileSync('/usr/sbin/scutil', ['--get', key], { encoding: 'utf8', timeout: 1500 }).trim(); }
    catch { return ''; }
  };
  const host = readName('LocalHostName') || os.hostname().replace(/\.local$/i, '');
  return { host, names: [host, `${host}.local`, os.hostname(), readName('ComputerName'), 'localhost', '127.0.0.1'] };
}

export async function runEntry(args, { input = process.stdin, output = process.stdout,
  errorOutput = process.stderr, machine = localMachine, openConsole = runConsole } = {}) {
  if (args.length === 1 && ['--version', '-v'].includes(args[0])) {
    output.write(`${VERSION}\n`);
    return 0;
  }
  const help = `CodeX视频壁纸

用法：
  codex-wallpaper                 自动连接本机，成功后进入菜单
  codex-wallpaper connect [本机名] 显式指定本机；省略名称时自动识别
  codex-wallpaper --help          查看帮助，不建立连接
  codex-wallpaper --version       查看壁纸工具版本

支持本地 MP4 单视频循环与多视频轮播，不支持图片。
绿色代表连接成功，黄色代表等待或警告，红色代表错误。
退出菜单或关闭终端后，后台壁纸继续运行。
需要重启 Codex 时会先提示，确认后才重启。
`;
  if (args.length === 1 && ['--help', '-h', 'help'].includes(args[0])) {
    output.write(help);
    return 0;
  }
  if (args.length && (args[0] !== 'connect' || args.length > 2 || args[1]?.startsWith('-'))) {
    errorOutput.write(paint('参数不正确。运行 codex-wallpaper --help 查看用法。', 'error', errorOutput) + '\n');
    return 2;
  }
  const local = machine();
  const target = args[1];
  if (target !== undefined && !local.names.some(name => name && name.toLowerCase() === target.toLowerCase())) {
    errorOutput.write(paint(`仅支持连接本机：${JSON.stringify(local.host)}。直接运行 codex-wallpaper 即可。`, 'error', errorOutput) + '\n');
    return 2;
  }
  if (!input.isTTY) {
    errorOutput.write(paint('请在交互式终端中运行 codex-wallpaper；查看帮助可使用 --help。', 'error', errorOutput) + '\n');
    return 2;
  }
  try { return await openConsole({ input, output, hostName: local.host }) ?? 0; }
  catch (error) {
    errorOutput.write(paint(`[CodeX视频壁纸] ${error.message}`, 'error', errorOutput) + '\n');
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runEntry(process.argv.slice(2));
}
