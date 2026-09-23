import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
// 原创数学渐变，不使用用户视频、图片或外部素材。
const glow = (x, y, sx, sy) => `exp(-(${x})^2/${sx}-(${y})^2/${sy})`;
const x1 = '(X/W-(0.28+0.16*sin(T*0.65)))';
const y1 = '(Y/H-(0.32+0.22*cos(T*0.5)))';
const x2 = '(X/W-(0.8+0.14*cos(T*0.55)))';
const y2 = '(Y/H-(0.7+0.22*sin(T*0.48)))';
const x3 = '(X/W-(0.4+0.2*cos(T*0.35)))';
const y3 = '(Y/H-(0.75+0.18*sin(T*0.7)))';
const a = glow(x1, y1, '.09', '.32');
const b = glow(x2, y2, '.05', '.18');
const c = glow(x3, y3, '.045', '.15');
const looks = [
  ['aurora.mp4', [`10+78*${a}+12*${b}+34*${c}`, `16+34*${a}+128*${b}+33*${c}`, `38+142*${a}+128*${b}+108*${c}`]],
  ['ember.mp4', [`25+163*${a}+73*${b}+104*${c}`, `13+47*${a}+37*${b}+63*${c}`, `33+62*${a}+116*${b}+38*${c}`]],
];
for (const [name, channels] of looks) {
  const filter = `nullsrc=s=640x400:r=30,geq=r='${channels[0]}':g='${channels[1]}':b='${channels[2]}',scale=1280:800:flags=lanczos`;
  await new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', filter, '-t', '8', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(directory, 'assets', name)], { stdio: 'inherit' });
    proc.on('exit', code => code === 0 ? resolve() : reject(new Error(`生成背景失败：${code}`)));
  });
  console.log('已生成原创背景：' + name);
}
