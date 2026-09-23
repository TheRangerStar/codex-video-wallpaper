// 终端着色与文件日志分离；重定向输出和 NO_COLOR 保留纯文本。
export function paint(text, level = 'info', output = process.stdout) {
  const code = { success: 32, warning: 33, error: 31 }[level];
  return code && output.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb'
    ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export function connectionMessage(state) {
  if (state.phase === 'error') return { level: 'error', text: `连接失败：${state.error || '请查看运行日志'}` };
  if (!state.running) return { level: 'info', text: '壁纸已关闭 · 未连接 Codex' };
  if (state.error) return { level: 'error', text: `连接异常 · ${state.error}` };
  if (state.phase === 'waiting-for-exit') return {
    level: 'warning', text: `尚未连接 · Codex 未开放端口 ${state.port ?? 9463}，需要退出重开`,
  };
  if (state.phase === 'connected' && state.connected === true) return { level: 'success', text: '连接成功 · CodeX 已就绪' };
  if (state.connected === true && state.loading) return { level: 'warning', text: '已连接 · 正在加载下一段视频' };
  if (state.phase === 'playing' && state.connected === true) return {
    level: 'success', text: state.requestedPause ? '连接成功 · 视频已暂停'
      : state.paused ? '连接成功 · 窗口隐藏，暂缓播放' : '连接成功 · 视频播放中',
  };
  return { level: 'warning', text: state.phase === 'reconnecting'
    ? '连接已断开 · 正在重新连接' : '正在连接 Codex · 尚未收到窗口连接确认' };
}
