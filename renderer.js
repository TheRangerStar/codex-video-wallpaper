// 视频直接挂在 body 下，与 React 的 #root 并列；页面切换不会更换视频。
(function installVideoWallpaper(options) {
  const KEY = '__codexLocalVideoWallpaper';
  const old = window[KEY];
  if (old) {
    if (old.owner !== options.owner) return { state: 'busy' };
    return old.update(options);
  }
  const root = document.getElementById('root');
  const main = document.querySelector('[data-app-shell-main-surface]');
  if (!root || !main || !document.body) return { state: 'waiting' };
  if (document.documentElement.classList.contains('compact-window') ||
      document.querySelector('[data-avatar-overlay]')) return { state: 'excluded' };

  const marker = 'data-codex-local-video';
  const surfaceMarker = 'data-codex-local-video-surface';
  const marked = new Set();
  const summaryPanel = '.rounded-3xl.bg-surface-elevated-secondary:has([data-slot^="thread-summary-panel-"])';
  const settingsPanel = '[class~="group/settings"]:not([role="dialog"] *)';
  const composerUtility = '[data-composer-placement="home"][class*="_ComposerHomeUtilityBar_"]';
  const style = document.createElement('style');
  style.id = 'codex-local-video-style';
  // 窗口与工具栏不染色视频；来源面板、文件卡片只作局部模糊，不铺白底。
  const baseCSS = `
    html[${marker}] body { isolation:isolate; }
    html[${marker}] #root { position:relative; z-index:1; background:transparent!important; }
    html[${marker}] [${surfaceMarker}],
    html[${marker}] [data-app-shell-main-surface],
    html[${marker}] .app-shell-left-panel,
    html[${marker}] [data-app-shell-unified-tab-strip] {
      background-color:transparent!important; background-image:none!important;
    }
    html[${marker}] [data-app-shell-main-content-top-fade],
    html[${marker}] [data-app-shell-header-toolbar] > :not([data-app-shell-thread-content-overlap]),
    html[${marker}] [aria-hidden="true"].pointer-events-none.bg-gradient-to-t.from-surface.via-surface {
      background:transparent!important;
    }
    html[${marker}] ${summaryPanel},
    html[${marker}] [class*="--thread-resource-card-max-width"]:has([class~="group/turn-diff-header"]) {
      background:transparent!important;
      backdrop-filter:blur(12px);
    }
    html[${marker}] ${summaryPanel} header.bg-surface-elevated-secondary,
    html[${marker}] ${summaryPanel} header.bg-surface-elevated-secondary::before {
      background:transparent!important;
    }
    html[${marker}] [class~="group/turn-diff-file-row"] [class~="bg-surface/70"],
    html[${marker}] [class~="group/turn-diff-header"] [class~="bg-surface-secondary/92"] {
      background:transparent!important;
    }
    html[${marker}] .app-shell-left-panel {
      backdrop-filter:blur(12px);
      --color-codex-icon:var(--codex-wallpaper-ink);
      --color-codex-icon-active:var(--codex-wallpaper-ink);
      --color-codex-description:var(--color-text-secondary);
      --color-token-foreground:var(--codex-wallpaper-ink);
    }
    /* 原侧栏会用继承背景向右延伸一条色带；玻璃只覆盖侧栏本身。 */
    html[${marker}] .app-shell-left-panel::after { background:transparent!important; }
    html[${marker}] ${settingsPanel} {
      border-radius:16px;backdrop-filter:blur(12px);
    }
    /* 设置分组 iDs 的白底来自内联变量，并不是 bg-surface 类；透出外层玻璃。 */
    html[${marker}] ${settingsPanel} .rounded-2xl[style*="--color-background-panel"] {
      background-color:transparent!important;
    }
    /* 导航内部会重设 --color-text；只改侧栏外层无法影响实际条目。 */
    html[${marker}] .app-shell-left-panel .sidebar-navigation nav[role="navigation"] {
      --color-text:var(--codex-wallpaper-ink);
      color:var(--codex-wallpaper-ink);
    }
    /* 按钮的原生样式会清除文字阴影；沿用所选档位，透明玻璃上仍保留文字轮廓。 */
    html[${marker}] .app-shell-left-panel .sidebar-item { text-shadow:inherit; }
    html[${marker}] .app-shell-left-panel .sidebar-item:hover:not(:disabled):not([aria-disabled="true"]) {
      background:color-mix(in srgb, var(--codex-wallpaper-ink) 10%, transparent)!important;
    }
    html[${marker}] .app-shell-left-panel .sidebar-item[aria-current="page"],
    html[${marker}] .app-shell-left-panel .sidebar-item:has([aria-current="page"]) {
      background:color-mix(in srgb, var(--codex-wallpaper-ink) 20%, transparent)!important;
      box-shadow:inset 3px 0 var(--codex-wallpaper-focus);
    }
    html[${marker}] .app-shell-left-panel .sidebar-item[aria-disabled="true"]:not(:disabled) {opacity:.55;}
    html[${marker}] #root :is(input,textarea,[contenteditable="true"],[contenteditable="plaintext-only"]):not(.ProseMirror-hideselection):not(.caret-transparent):not(.ProseMirror-hideselection *):not(.caret-transparent *):not(.monaco-editor *):not(.xterm *) {
      caret-color:var(--codex-wallpaper-caret,currentColor);
    }
    html[${marker}] #root :is(input,textarea)::placeholder {
      color:var(--color-text-tertiary);opacity:1;
    }
    html[${marker}] #root::selection,
    html[${marker}] #root :not(.placeholder):not(.placeholder *):not([data-invalid] *):not(.monaco-editor *):not(.xterm *)::selection {
      background-color:var(--codex-wallpaper-selection-bg);
      color:var(--codex-wallpaper-selection-ink);text-shadow:none;
    }
    html[${marker}] #root :is(button,a,input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]):focus-visible:not(:disabled):not([aria-disabled="true"]):not([aria-invalid="true"]):not([data-invalid] *):not(.monaco-editor *):not(.xterm *) {
      outline:2px solid var(--codex-wallpaper-focus);outline-offset:2px;
    }
    /* 聊天输入区用光标提示输入位置，不额外显示焦点外框。 */
    html[${marker}] #root [data-composer-surface-variant] :is(input,textarea,[contenteditable]):focus-visible:not([aria-invalid="true"]):not([data-invalid] *) {
      outline:none!important;
    }
    html[${marker}] [class~="group/turn-diff-header"] button:not([class~="inset-0"]) {
      color:var(--codex-wallpaper-ink)!important;
      background:color-mix(in srgb, var(--codex-wallpaper-ink) 8%, transparent)!important;
    }
    html[${marker}] [data-composer-surface-variant="default"]:not([data-composer-drag-active]),
    html[${marker}] [data-composer-surface-variant="opaque"]:not([data-composer-drag-active]) {
      --composer-layout-surface-background:color-mix(in srgb, var(--color-surface) 32%, transparent)!important;
      --composer-layout-surface-backdrop-filter:blur(18px)!important;
    }
    /* 项目/环境栏可能位于输入框外的 rail，需独立玻璃层和文字配色。 */
    html[${marker}] ${composerUtility} {
      background:color-mix(in srgb, var(--color-surface) 32%, transparent)!important;
      backdrop-filter:blur(18px);
    }
    /* 附件底板透出输入框玻璃；只移除 UI 底色，不改预览图片、点击层或删除按钮。 */
    html[${marker}] [data-composer-surface-variant] [data-composer-attachments] :is(
      .composer-attachment-surface.bg-surface-secondary,
      .composer-attachment-surface.bg-primary-soft,
      .composer-attachment-surface > .bg-surface,
      .composer-attachment-surface [class~="bg-surface-secondary/92"]) {
      background:transparent!important;
    }
    #codex-local-video-layer {
      position:fixed; inset:0; z-index:0; pointer-events:none!important;
      overflow:hidden; background:var(--color-surface, var(--app-color-background-surface, #181818));
    }
    #codex-local-video-layer video {
      display:block; width:100%; height:100%; object-fit:cover;
      filter:none!important; mix-blend-mode:normal!important;
      pointer-events:none!important;
    }
    #codex-local-video-transition {
      position:absolute; inset:0; width:100%; height:100%; object-fit:cover;
      pointer-events:none!important;
    }
  `;
  const layer = document.createElement('div');
  layer.id = 'codex-local-video-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.inert = true;
  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.volume = 0;
  video.loop = true;
  video.autoplay = true;
  video.playsInline = true;
  video.disablePictureInPicture = true;
  video.preload = 'auto';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/mp4';
  input.multiple = true;
  input.id = 'codex-local-video-file';
  input.hidden = true;
  // 此 input 在应用 React 树之外，不会提交给聊天或触发上传。
  layer.append(video, input);
  document.head.append(style);
  document.body.prepend(layer);
  document.documentElement.setAttribute(marker, '');
  let blobUrl = null;
  let lastHeartbeat = Date.now();
  let failure = null;
  let disposed = false;
  let wantedPause = false;
  let lastTime = 0;
  let appearance = options.appearance || null;
  let files = [];
  let playlistIndex = 0;
  let loading = false;
  let warning = null;
  let loadGeneration = 0;
  const failedFiles = new Set();
  let transitionCover = null;
  let transitionAnimation = null;
  let transitionTimer = null;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function clearTransition() {
    const cover = transitionCover;
    transitionCover = null;
    transitionAnimation?.cancel();
    transitionAnimation = null;
    clearTimeout(transitionTimer);
    transitionTimer = null;
    if (cover) { cover.remove(); cover.width = 0; cover.height = 0; }
  }
  function freezeFrame() {
    if (document.hidden || !blobUrl || video.readyState < 2 || !video.videoWidth) return;
    // 只在换片时抓取一帧，不持续采样或同时解码两段视频。快照最多约 1080p。
    const rect = layer.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const cover = document.createElement('canvas');
    const scale = Math.min(devicePixelRatio || 1, 1920 / rect.width, 1080 / rect.height);
    cover.width = Math.max(1, Math.round(rect.width * scale));
    cover.height = Math.max(1, Math.round(rect.height * scale));
    const brush = cover.getContext('2d', { alpha: false });
    if (!brush) { cover.width = 0; cover.height = 0; return; }
    try {
      brush.fillStyle = getComputedStyle(layer).backgroundColor;
      brush.fillRect(0, 0, cover.width, cover.height);
      const fit = Math.max(cover.width / video.videoWidth, cover.height / video.videoHeight);
      brush.globalAlpha = Number(video.style.opacity || 1);
      brush.drawImage(video, (cover.width - video.videoWidth * fit) / 2,
        (cover.height - video.videoHeight * fit) / 2, video.videoWidth * fit, video.videoHeight * fit);
      // 短片可能在上次淡出结束前播完，合成当前看到的画面，避免叠加多个过渡层。
      if (transitionCover) {
        brush.globalAlpha = Number(getComputedStyle(transitionCover).opacity);
        brush.drawImage(transitionCover, 0, 0, cover.width, cover.height);
      }
    } catch { cover.width = 0; cover.height = 0; return; }
    clearTransition();
    cover.id = 'codex-local-video-transition';
    transitionCover = cover;
    layer.append(cover);
  }
  function revealNextFrame() {
    if (!transitionCover) return;
    if (document.hidden || reducedMotion.matches) { clearTransition(); return; }
    const cover = transitionCover;
    transitionAnimation = cover.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 600, easing: 'ease-in-out', fill: 'forwards',
    });
    const finish = () => { if (transitionCover === cover) clearTransition(); };
    transitionAnimation.finished.then(finish, finish);
    // 页面失活时动画结束通知可能延后，确保临时画布不会长期占用内存。
    transitionTimer = setTimeout(finish, 900);
  }

  // 只读取本地视频的缩略帧。各区域独立判断，避免侧栏很暗、内容区很亮时用错颜色。
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 36;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const linear = Array.from({ length: 256 }, (_, value) => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const zones = [
    { name: 'content', selector: '#root', sample: '[data-app-shell-main-surface]' },
    { name: 'sidebar', selector: '.app-shell-left-panel' },
    { name: 'settings', selector: settingsPanel },
    { name: 'sources', selector: summaryPanel },
    { name: 'composer', selector: '[data-composer-surface-variant]' },
    { name: 'composerUtility', selector: composerUtility },
  ].map(zone => ({ ...zone, mode: null, pending: 0, luminance: null }));
  const colorTokens = {
    '--color-text': 'ink', '--color-text-emphasis': 'ink', '--color-text-prose': 'ink',
    '--color-text-primary': 'ink', '--color-text-user-message': 'ink',
    '--color-text-secondary': 'muted', '--color-text-secondary-solid': 'muted',
    '--color-text-tertiary': 'subtle', '--color-token-text-primary': 'ink',
    '--color-token-text-secondary': 'muted', '--color-token-text-tertiary': 'subtle',
    '--color-text-disabled': 'subtle',
  };
  const palettes = {
    light: { ink: '#f5f7fa', muted: '#dce2eb', subtle: '#c4cedc', shadow: '0 1px 3px #000d, 0 0 1px #000a' },
    dark: { ink: '#141820', muted: '#303845', subtle: '#465162', shadow: '0 1px 2px #fffc' },
  };
  const luminance = rgb => rgb.reduce((sum, value, i) => sum + linear[Math.round(value)] * [0.2126, 0.7152, 0.0722][i], 0);
  const shade = (rgb, target, amount) => '#' + rgb.map(value => Math.round(value * (1 - amount) + target * amount).toString(16).padStart(2, '0')).join('');
  function readingAlpha(ink, brightText, minimum) {
    if (!minimum) return 0;
    const foreground = luminance(ink.slice(1).match(/../g).map(value => parseInt(value, 16)));
    const tint = brightText ? [12, 15, 20] : [255, 255, 255];
    const worst = brightText ? 255 : 0;
    // 阅读与输入区域需要稳定可读，不随镜头闪变。按最不利的亮/暗背景算局部底色。
    for (let alpha = minimum; alpha < 0.86; alpha += 0.01) {
      const background = luminance(tint.map(value => value * alpha + worst * (1 - alpha)));
      const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      if (contrast >= 4.5) return Math.round(alpha * 100) / 100;
    }
    return 0.86;
  }
  let lastCSS = '';
  function renderContrast() {
    let css = zones.map(zone => {
      const fixed = appearance?.mode === 'fixed';
      const rgb = fixed ? appearance.color.slice(1).match(/../g).map(value => parseInt(value, 16)) : null;
      const brightText = fixed ? luminance(rgb) > 0.35 : zone.mode !== 'dark';
      const palette = { ...palettes[brightText ? 'light' : 'dark'] };
      if (fixed) {
        palette.ink = appearance.color;
        // 次要文字保留所选色相，用实色阶区分，避免透明文字再与视频叠加。
        palette.muted = shade(rgb, brightText ? 0 : 255, 0.08);
        palette.subtle = shade(rgb, brightText ? 0 : 255, 0.16);
      }
      if (appearance?.shadow === 'none') palette.shadow = 'none';
      if (appearance?.shadow === 'strong') {
        const edge = brightText ? '#000d' : '#fffd';
        palette.shadow = `-1px 0 ${edge}, 1px 0 ${edge}, 0 -1px ${edge}, 0 1px ${edge}, ${palette.shadow}`;
      }
      const readingPanel = ['settings', 'composer', 'composerUtility'].includes(zone.name);
      const alpha = appearance && readingPanel ? readingAlpha(palette.subtle, brightText, appearance.glass) : appearance?.glass ?? 0;
      // 已有足够底色的文字无需厚阴影，避免细字看起来发虚。
      if (readingPanel && alpha && appearance?.shadow === 'soft') palette.shadow = 'none';
      const tokens = Object.entries(colorTokens).map(([key, shade]) => `${key}:${palette[shade]};`).join('');
      return `html[${marker}] ${zone.selector} {${tokens}
        --codex-wallpaper-ink:${palette.ink};color:${palette.ink};text-shadow:${palette.shadow};
        --codex-wallpaper-caret:${brightText ? '#ffffff' : '#111827'};
        --color-codex-editor-cursor:var(--codex-wallpaper-caret);
        --input-text-color:var(--color-text);--input-placeholder-text-color:var(--color-text-tertiary);
        --composer-editor-placeholder-opacity:1;
        --codex-wallpaper-focus:${brightText ? '#a8dcff' : '#175fc2'};
        --codex-wallpaper-selection-bg:${brightText ? '#b8dfff' : '#195fbd'};
        --codex-wallpaper-selection-ink:${brightText ? '#102139' : '#ffffff'};
        --codex-wallpaper-plate:rgba(${brightText ? '12,15,20' : '255,255,255'},${alpha});}`;
    }).join('\n');
    if (appearance) {
      // 只在已有面板和消息文字块背后加底色，保留未被 UI 覆盖的视频原色。
      css += `html[${marker}] .app-shell-left-panel,
        html[${marker}] ${settingsPanel},
        html[${marker}] ${summaryPanel},
        html[${marker}] [class*="--thread-resource-card-max-width"]:has([class~="group/turn-diff-header"]) {
        background:var(--codex-wallpaper-plate)!important;
      }
      html[${marker}] ${settingsPanel} {box-shadow:0 0 0 16px var(--codex-wallpaper-plate);}
      html[${marker}] [data-composer-surface-variant]:not([data-composer-drag-active]) {
        --composer-layout-surface-background:var(--codex-wallpaper-plate)!important;
      }
      html[${marker}] ${composerUtility} {
        background:var(--codex-wallpaper-plate)!important;
      }`;
      if (appearance.glass > 0) {
        css += `html[${marker}] [data-app-shell-main-surface] :is(
          [data-markdown-text-style="assistant-message"], [data-markdown-text-tone="user-message"]) {
          background:var(--codex-wallpaper-plate);
          box-shadow:0 0 0 8px var(--codex-wallpaper-plate);
          border-radius:10px;backdrop-filter:blur(12px);
        }`;
      }
    }
    // 菜单、对话框、代码与实心按钮仍使用客户端主题；红绿差异、链接等语义色不覆盖。
    const original = getComputedStyle(document.body);
    const restore = Object.keys(colorTokens).map(key => {
      const value = original.getPropertyValue(key).trim();
      return value ? `${key}:${value};` : '';
    }).join('');
    const settingsOpaque = `${settingsPanel} :is(.bg-surface, .bg-surface-secondary, .bg-surface-elevated-secondary, [data-testid="theme-preview"])`;
    const nativeFieldSurface = `:is(input,textarea,:has(> input,> textarea)):is(.bg-surface,.bg-surface-secondary,.bg-surface-elevated-secondary):not([${surfaceMarker}]):not([data-composer-surface-variant])`;
    css += `html[${marker}] #root ${settingsOpaque},
      html[${marker}] #root ${nativeFieldSurface},
      html[${marker}] #root :is([role="menu"], [role="dialog"], [role="listbox"],
      [data-radix-popper-content-wrapper], pre, .bg-primary-solid) {
      ${restore}text-shadow:none;
      --codex-wallpaper-caret:currentColor;--color-codex-editor-cursor:var(--color-text);
      --input-text-color:var(--color-text);--input-placeholder-text-color:var(--color-text-tertiary);
      --codex-wallpaper-focus:var(--color-ring,#175fc2);
      --codex-wallpaper-selection-bg:#195fbd;--codex-wallpaper-selection-ink:#ffffff;
    }
    html[${marker}] #root ${settingsOpaque},
      html[${marker}] #root ${nativeFieldSurface},
      html[${marker}] #root :is([role="menu"], [role="dialog"], [role="listbox"],
      [data-radix-popper-content-wrapper]) {color:var(--color-text);}
    html[${marker}] #root .bg-primary-solid {color:var(--color-text-primary-solid);}`;
    if (css !== lastCSS) {
      lastCSS = css;
      style.textContent = baseCSS + css;
    }
  }
  function sampleContrast() {
    if (disposed || document.hidden || !context || video.readyState < 2 || video.seeking) return;
    if (appearance?.mode === 'fixed') return;
    // object-fit:cover 的裁剪必须一致，采样才对应文字背后的实际画面。
    const scale = Math.max(innerWidth / video.videoWidth, innerHeight / video.videoHeight);
    const width = innerWidth / scale, height = innerHeight / scale;
    context.globalAlpha = 1;
    context.fillStyle = getComputedStyle(layer).backgroundColor;
    context.fillRect(0, 0, 64, 36);
    context.globalAlpha = Number(video.style.opacity || 1);
    context.drawImage(video, (video.videoWidth - width) / 2, (video.videoHeight - height) / 2,
      width, height, 0, 0, 64, 36);
    const pixels = context.getImageData(0, 0, 64, 36).data;
    for (const zone of zones) {
      const node = document.querySelector(zone.sample || zone.selector);
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      const x1 = Math.max(0, Math.floor(rect.left / innerWidth * 64));
      const x2 = Math.min(64, Math.ceil(rect.right / innerWidth * 64));
      const y1 = Math.max(0, Math.floor(rect.top / innerHeight * 36));
      const y2 = Math.min(36, Math.ceil(rect.bottom / innerHeight * 36));
      let sum = 0, count = 0;
      for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) {
        const i = (y * 64 + x) * 4;
        sum += 0.2126 * linear[pixels[i]] + 0.7152 * linear[pixels[i + 1]] + 0.0722 * linear[pixels[i + 2]];
        count++;
      }
      if (!count) continue;
      zone.luminance = sum / count;
      // 明暗阈值留出缓冲，并连续确认两次，避免视频轻微变化时来回闪色。
      const threshold = zone.mode === 'light' ? 0.24 : zone.mode === 'dark' ? 0.15 : 0.19;
      const mode = zone.luminance > threshold ? 'dark' : 'light';
      if (mode === zone.mode) zone.pending = 0;
      else if (!zone.mode || ++zone.pending >= 2) { zone.mode = mode; zone.pending = 0; }
    }
    renderContrast();
  }
  renderContrast();
  let contrastTimer;
  function configureContrast() {
    clearInterval(contrastTimer);
    if (appearance?.mode !== 'fixed') contrastTimer = setInterval(sampleContrast, 1200);
  }
  configureContrast();

  function markShell() {
    for (const node of marked) if (!node.isConnected) marked.delete(node);
    for (const shell of document.querySelectorAll(`[data-app-shell-main-surface], .app-shell-left-panel, ${settingsPanel}`)) {
      for (let node = shell; node && node !== document.body; node = node.parentElement) {
        if (!node.hasAttribute(surfaceMarker)) {
          node.setAttribute(surfaceMarker, '');
          marked.add(node);
        }
      }
    }
  }
  markShell();
  const shellSelector = `[data-app-shell-main-surface], .app-shell-left-panel, ${settingsPanel}`;
  // 只在壳层出现/移走时重新标记，聊天文字流式更新无需扫描整棵树。
  const shellObserver = new MutationObserver(records => {
    const changed = records.some(record => [...record.addedNodes].some(node =>
      node.nodeType === 1 && (node.matches(shellSelector) || node.querySelector(shellSelector))));
    if (changed || [...marked].some(node => !node.isConnected)) markShell();
  });
  shellObserver.observe(root, { childList: true, subtree: true });
  const themeObserver = new MutationObserver(() => renderContrast());
  for (const node of [document.documentElement, document.body]) {
    themeObserver.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  }
  function report() {
    return {
      state: failure ? 'error' : loading ? 'loading' : blobUrl ? 'playing' : 'needs-file',
      error: failure,
      warning, playlistIndex, playlistCount: files.length, loading,
      transitioning: Boolean(transitionCover),
      ready: video.readyState,
      paused: video.paused,
      time: video.currentTime,
      width: video.videoWidth,
      height: video.videoHeight,
      opacity: video.style.opacity,
      appearance,
      contrast: Object.fromEntries(zones.map(zone => [zone.name, { text: zone.mode, luminance: zone.luminance }])),
    };
  }
  function resumeIfVisible() {
    if (document.hidden) clearTransition();
    if (document.hidden || wantedPause) video.pause();
    else if (blobUrl && !loading) video.play().catch(e => { if (!disposed && e.name !== 'AbortError') failure = e.message; });
  }
  const onError = () => {
    if (loading || disposed) return;
    failedFiles.add(playlistIndex);
    warning = `已跳过无法播放的视频：${files[playlistIndex]?.name || '未知视频'}`;
    void loadAt((playlistIndex + 1) % files.length);
  };
  async function loadAt(start, resumeTime = 0) {
    const generation = ++loadGeneration;
    freezeFrame();
    loading = true;
    failure = null;
    video.loop = files.length === 1;
    for (let attempt = 0; attempt < files.length; attempt++) {
      const index = (start + attempt) % files.length;
      if (failedFiles.has(index)) continue;
      if (disposed || generation !== loadGeneration) return report();
      playlistIndex = index;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(files[index]);
      video.src = blobUrl;
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => finish(new Error('视频加载超时。')), 15000);
          const good = () => finish();
          const bad = () => finish(new Error('视频解码失败，请使用可播放的 H.264 MP4。'));
          const finish = error => {
            clearTimeout(timer);
            video.removeEventListener('loadeddata', good);
            video.removeEventListener('error', bad);
            video.removeEventListener('emptied', interrupted);
            error ? reject(error) : resolve();
          };
          const interrupted = () => { if (disposed) finish(new Error('壁纸已关闭。')); };
          video.addEventListener('loadeddata', good, { once: true });
          video.addEventListener('error', bad, { once: true });
          video.addEventListener('emptied', interrupted);
          if (video.readyState >= 2) finish();
        });
        if (disposed || generation !== loadGeneration) return report();
        if (attempt === 0 && resumeTime > 0 && resumeTime < video.duration) video.currentTime = resumeTime;
        loading = false;
        if (!document.hidden && !wantedPause) {
          try { await video.play(); }
          catch (error) { if (error.name !== 'AbortError' || !document.hidden && !wantedPause) throw error; }
        }
        else video.pause();
        if (disposed || generation !== loadGeneration) return report();
        revealNextFrame();
        sampleContrast();
        return report();
      } catch (error) {
        if (disposed || generation !== loadGeneration) return report();
        failedFiles.add(index);
        warning = `已跳过无法播放的视频：${files[index].name}（${error.message}）`;
      }
    }
    loading = false;
    failure = '播放列表中的视频均无法播放，请重新选择视频。';
    clearTransition();
    return report();
  }
  const onEnded = () => { if (!loading && !disposed && files.length > 1) void loadAt((playlistIndex + 1) % files.length); };
  video.addEventListener('error', onError);
  video.addEventListener('ended', onEnded);
  document.addEventListener('visibilitychange', resumeIfVisible);
  // 脚本意外退出时恢复原外观；普通页面切换不触发销毁。
  const watchdog = setInterval(() => {
    if (Date.now() - lastHeartbeat > 20000) api.remove();
  }, 5000);
  const api = {
    owner: options.owner,
    report,
    heartbeat() { lastHeartbeat = Date.now(); return report(); },
    update(next) {
      lastHeartbeat = Date.now();
      if (video.style.opacity !== String(next.opacity)) video.style.opacity = String(next.opacity);
      wantedPause = Boolean(next.paused);
      if (JSON.stringify(next.appearance || null) !== JSON.stringify(appearance)) {
        appearance = next.appearance || null;
        renderContrast();
        configureContrast();
      }
      if (wantedPause !== video.paused) resumeIfVisible();
      return report();
    },
    async load() {
      files = [...(input.files || [])];
      if (!files.length) throw new Error('没有收到本地视频文件。');
      input.remove();
      const index = Number.isInteger(options.resumeIndex) && options.resumeIndex >= 0 && options.resumeIndex < files.length ? options.resumeIndex : 0;
      return loadAt(index, options.resumeTime);
    },
    remove() {
      if (disposed) return;
      disposed = true;
      loadGeneration++;
      clearTransition();
      lastTime = video.currentTime;
      clearInterval(watchdog);
      clearInterval(contrastTimer);
      shellObserver.disconnect();
      themeObserver.disconnect();
      document.removeEventListener('visibilitychange', resumeIfVisible);
      video.removeEventListener('error', onError);
      video.removeEventListener('ended', onEnded);
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      files = [];
      for (const node of marked) node.removeAttribute(surfaceMarker);
      document.documentElement.removeAttribute(marker);
      layer.remove();
      style.remove();
      if (window[KEY] === api) delete window[KEY];
      return { state: 'removed', time: lastTime };
    },
  };
  window[KEY] = api;
  return api.update(options);
})
