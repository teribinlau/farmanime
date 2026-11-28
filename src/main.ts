// 群芳牧场 —— 微信小游戏（原生 Canvas 2D，无引擎）
// 规则在 core/，这里只负责绘制和触摸。浏览器试玩时由 web/index.html 提供一个简化版 wx。
import { COLS, ROWS, DAYS_PER_WEEK, TERRAINS, CREATURES, RELICS, ITEMS, cardInfo, Card, RelicId } from './core/Data';
import { RanchGame, POOL_MAX } from './core/RanchGame';

declare const wx: any;
/** 打包时由 build.mjs 写入：images/ 里实际存在的图片 key */
declare const __IMAGES__: string[];

const GAME_TITLE = '群芳牧场';
const STORAGE_KEY = 'qunfang_best';
const RUN_KEY = 'qunfang_run';
const MUTE_KEY = 'qunfang_mute';
const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';

// ---------- 平台与画布 ----------
const sys = wx.getSystemInfoSync();
const W: number = sys.windowWidth;
const H: number = sys.windowHeight;
const DPR: number = Math.min(3, sys.pixelRatio || 2);
const canvas = wx.createCanvas();
canvas.width = W * DPR;
canvas.height = H * DPR;
const ctx: CanvasRenderingContext2D = canvas.getContext('2d');
ctx.scale(DPR, DPR);

let menuBottom = 0;
try {
  if (wx.getMenuButtonBoundingClientRect) {
    const m = wx.getMenuButtonBoundingClientRect();
    if (m && m.bottom) menuBottom = m.bottom;
  }
} catch (e) { /* ignore */ }
const SAFE_TOP = menuBottom ? menuBottom + 6 : ((sys.safeArea && sys.safeArea.top) || 20) + 8;
const SAFE_BOTTOM = sys.safeArea ? Math.max(0, H - sys.safeArea.bottom) : 0;

// ---------- 图片 ----------
const images: Record<string, any> = {};
const IMAGE_KEYS = [
  'heroine', 'bg_title', 'bg_scene',
  ...Object.keys(RELICS).map((k) => RELICS[k as RelicId].art),
  'lord_yuanshu', 'lord_liubiao', 'lord_yuanshao', 'lord_sunquan', 'lord_liubei', 'lord_caocao', 'lord_simayi', 'lord_dongzhuo',
  ...Object.keys(CREATURES),
  ...Object.keys(TERRAINS).map((k) => 'tile_' + k),
  ...Object.keys(ITEMS).map((k) => 'item_' + k),
];
function loadImages() {
  let keys = IMAGE_KEYS.slice();
  keys.forEach((k) => {
    if (k.startsWith('hero') || k.startsWith('lord_')) keys.push('avatar_' + k);
  });
  const have = typeof __IMAGES__ !== 'undefined' ? __IMAGES__ : null;
  if (have) keys = keys.filter((k) => have.indexOf(k) >= 0);
  keys.forEach((k) => {
    const img = wx.createImage();
    img.onload = () => { images[k] = img; };
    img.onerror = () => { /* 没有这张图就继续用 emoji */ };
    img.src = 'images/' + k + '.png';
  });
}
function img(key: string) { return images[key] || null; }

// ---------- 音效与震动 ----------
/** 打包时由 build.mjs 写入：audio/ 里实际存在的音效 */
declare const __SOUNDS__: string[];
const sounds: Record<string, any> = {};
let muted = false;
try { muted = !!wx.getStorageSync(MUTE_KEY); } catch (e) { /* ignore */ }
function loadSounds() {
  if (typeof __SOUNDS__ === 'undefined' || !wx.createInnerAudioContext) return;
  __SOUNDS__.forEach((k) => {
    try {
      const a = wx.createInnerAudioContext();
      a.src = 'audio/' + k + '.wav';
      if ('obeyMuteSwitch' in a) a.obeyMuteSwitch = true;
      sounds[k] = a;
    } catch (e) { /* ignore */ }
  });
}
function sfx(k: string) {
  if (muted) return;
  const a = sounds[k];
  if (!a) return;
  try { a.stop(); a.seek && a.seek(0); a.play(); } catch (e) { /* ignore */ }
}
function buzz(heavy = false) {
  if (muted) return;
  try { wx.vibrateShort && wx.vibrateShort({ type: heavy ? 'medium' : 'light' }); } catch (e) { /* ignore */ }
}
function toggleMute() {
  muted = !muted;
  try { wx.setStorageSync(MUTE_KEY, muted ? 1 : 0); } catch (e) { /* ignore */ }
  if (!muted) sfx('tap');
}

// ---------- 存档 ----------
function saveRun() {
  try { wx.setStorageSync(RUN_KEY, game.save()); } catch (e) { /* ignore */ }
}
function savedRun(): string {
  try { return String(wx.getStorageSync(RUN_KEY) || ''); } catch (e) { return ''; }
}

// ---------- 状态 ----------
const game = new RanchGame();
try { game.best = Number(wx.getStorageSync(STORAGE_KEY)) || 0; } catch (e) { /* ignore */ }

interface Float { x: number; y: number; text: string; color: string; t: number; }
let floats: Float[] = [];
interface Btn { x: number; y: number; w: number; h: number; onTap: () => void; label?: string; }
let buttons: Btn[] = [];
let waitUntil = 0;
let clock = 0;
const popAt: Record<number, number> = {};

// ---------- 布局 ----------
const PAD = 12;
const TOP_H = 66;
const BOARD_PAD = 8;
const INFO_H = 62;
const BTN_H = 52;
const BTN_Y = H - SAFE_BOTTOM - BTN_H - 14;
// 卡牌改成弹窗后，棋盘可以占满宽度，并在剩余空间里尽量大
const CELL = Math.floor(Math.min((W - PAD * 2 - BOARD_PAD * 2) / COLS,
  (BTN_Y - 14 - INFO_H - 12 - (SAFE_TOP + TOP_H + 12) - BOARD_PAD * 2) / ROWS));
const BOARD_X = Math.floor((W - CELL * COLS) / 2);
const BOARD_Y = Math.floor(SAFE_TOP + TOP_H + BOARD_PAD + 12
  + Math.max(0, (BTN_Y - 14 - INFO_H - 12 - (SAFE_TOP + TOP_H + 12) - BOARD_PAD * 2 - CELL * ROWS) / 2));
const INFO_Y = BTN_Y - 14 - INFO_H;

function cellCenter(i: number) {
  return { x: BOARD_X + (i % COLS) * CELL + CELL / 2, y: BOARD_Y + Math.floor(i / COLS) * CELL + CELL / 2 };
}

// ---------- 主题 ----------
const C = {
  // 浅色宣纸 + 墨线：cream 是正文墨色，gold 是铜褐描线，goldHi 是朱砂强调色
  ink: '#2a211b', panel: 'rgba(250,244,230,0.94)', panel2: 'rgba(242,233,214,0.96)',
  gold: '#9a7442', goldHi: '#b8432f', goldLo: '#5a3e22', cream: '#3a2e26', muted: '#85735f',
  crimson: '#b8432f', jade: '#2f8a6e', violet: '#6f9f8c',
  paper: '#f6efdf', line: 'rgba(90,64,40,0.62)', warn: '#c0392b', ok: '#2f8a6e',
};
const SERIF = '"Songti SC","STSongti-SC-Bold","Noto Serif SC","Source Han Serif SC","Noto Serif CJK SC","STSong",serif';

// ---------- 绘制工具 ----------
function rr(x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
/** 切角矩形（四角斜切），古风面板和按钮用 */
function chamfer(x: number, y: number, w: number, h: number, c: number) {
  ctx.beginPath();
  ctx.moveTo(x + c, y); ctx.lineTo(x + w - c, y); ctx.lineTo(x + w, y + c);
  ctx.lineTo(x + w, y + h - c); ctx.lineTo(x + w - c, y + h); ctx.lineTo(x + c, y + h);
  ctx.lineTo(x, y + h - c); ctx.lineTo(x, y + c);
  ctx.closePath();
}
function fillRR(x: number, y: number, w: number, h: number, r: number, color: string) {
  rr(x, y, w, h, r); ctx.fillStyle = color; ctx.fill();
}
function goldGrad(y0: number, y1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#4a3a2e'); g.addColorStop(0.55, '#2a211b'); g.addColorStop(1, '#14100c');
  return g;
}
/** 深色半透明面板 + 金色细边 + 四角纹饰 */
function panel(x: number, y: number, w: number, h: number, opt: { c?: number; fill?: string; corners?: boolean; glow?: string } = {}) {
  const c = opt.c === undefined ? 8 : opt.c;
  ctx.save();
  if (opt.glow) { ctx.shadowColor = opt.glow; ctx.shadowBlur = 16; }
  else { ctx.shadowColor = 'rgba(80,56,30,0.22)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3; }
  chamfer(x, y, w, h, c);
  if (opt.fill) ctx.fillStyle = opt.fill;
  else {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(252,247,235,0.95)'); g.addColorStop(1, 'rgba(242,232,210,0.95)');
    ctx.fillStyle = g;
  }
  ctx.fill();
  ctx.restore();
  chamfer(x + 0.5, y + 0.5, w - 1, h - 1, c);
  ctx.lineWidth = 1.2; ctx.strokeStyle = C.line; ctx.stroke();
  chamfer(x + 3.5, y + 3.5, w - 7, h - 7, Math.max(0, c - 2));
  ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(90,64,40,0.18)'; ctx.stroke();
  if (opt.corners !== false) {
    ctx.fillStyle = C.crimson;
    [[x + w / 2, y], [x + w / 2, y + h]].forEach(([cx, cy]) => {
      ctx.beginPath(); ctx.moveTo(cx, cy - 3.5); ctx.lineTo(cx + 3.5, cy); ctx.lineTo(cx, cy + 3.5); ctx.lineTo(cx - 3.5, cy); ctx.closePath(); ctx.fill();
    });
  }
}
type Align = 'left' | 'center' | 'right';
function text(s: string, x: number, y: number, size: number, color: string, align: Align = 'left', bold = false, font = FONT) {
  ctx.font = (bold ? 'bold ' : '') + size + 'px ' + font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}
/** 金色描边大字（标题、数字） */
function goldText(s: string, x: number, y: number, size: number, align: Align = 'center', font = SERIF) {
  ctx.font = 'bold ' + size + 'px ' + font;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size / 6); ctx.strokeStyle = 'rgba(255,251,240,0.92)';
  ctx.strokeText(s, x, y);
  ctx.fillStyle = goldGrad(y - size / 2, y + size / 2);
  ctx.fillText(s, x, y);
}
function shadowText(s: string, x: number, y: number, size: number, color: string, align: Align = 'left', bold = false, font = FONT) {
  ctx.save();
  ctx.shadowColor = 'rgba(255,250,238,0.95)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 0;
  text(s, x, y, size, color, align, bold, font);
  ctx.restore();
}
function wrap(s: string, x: number, y: number, maxW: number, size: number, color: string, lineH: number, maxLines: number, align: Align = 'left') {
  ctx.font = size + 'px ' + FONT;
  const lines: string[] = [];
  let line = '';
  for (const ch of Array.from(s)) {
    if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; } else line += ch;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
  }
  lines.forEach((l, k) => text(l, x, y + k * lineH, size, color, align));
  return lines.length;
}
function hit(x: number, y: number, w: number, h: number, onTap: () => void, label?: string) { buttons.push({ x, y, w, h, onTap, label }); }
type BtnStyle = 'gold' | 'crimson' | 'violet' | 'ghost';
/** 古风按钮：切角、渐变、顶部高光、金边 */
function button(label: string, x: number, y: number, w: number, h: number, onTap: () => void, style: BtnStyle = 'gold', enabled = true, size = 17) {
  const cols: Record<BtnStyle, [string, string, string]> = {
    gold: ['#d9654b', '#a8341f', '#fff8ec'],
    crimson: ['#b8432f', '#7e2416', '#fff3e3'],
    violet: ['#86b9a6', '#4a8571', '#fffaf0'],
    ghost: ['#fcf7ea', '#ebdfc6', C.cream],
  };
  const [a, b, fg] = enabled ? cols[style] : ['#ddd3c2', '#c4b8a4', '#8f8474'];
  const c = Math.min(12, h / 3);
  ctx.save();
  ctx.shadowColor = 'rgba(80,56,30,0.3)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
  chamfer(x, y, w, h, c);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, a); g.addColorStop(1, b);
  ctx.fillStyle = g; ctx.fill();
  ctx.restore();
  // 顶部高光
  ctx.save(); chamfer(x, y, w, h, c); ctx.clip();
  const hl = ctx.createLinearGradient(0, y, 0, y + h * 0.5);
  hl.addColorStop(0, 'rgba(255,255,255,0.35)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl; ctx.fillRect(x, y, w, h * 0.5);
  ctx.restore();
  chamfer(x + 0.5, y + 0.5, w - 1, h - 1, c);
  ctx.lineWidth = 1.2; ctx.strokeStyle = enabled ? (style === 'ghost' ? C.line : 'rgba(70,30,14,0.55)') : 'rgba(120,100,80,0.4)'; ctx.stroke();
  // 两侧小菱形
  if (w > 140) {
    ctx.fillStyle = enabled ? (style === 'ghost' ? C.crimson : 'rgba(255,240,220,0.85)') : '#a89c8a';
    [x + 18, x + w - 18].forEach((cx) => {
      const cy = y + h / 2;
      ctx.beginPath(); ctx.moveTo(cx, cy - 4); ctx.lineTo(cx + 4, cy); ctx.lineTo(cx, cy + 4); ctx.lineTo(cx - 4, cy); ctx.closePath(); ctx.fill();
    });
  }
  text(label, x + w / 2, y + h / 2 + 1, size, fg, 'center', true, SERIF);
  if (enabled) hit(x, y, w, h, onTap, label);
}
/** 等比画进框里；bottom=true 时脚底贴住框底（立绘用） */
function drawContain(im: any, cx: number, cy: number, bw: number, bh: number, bottom = false) {
  const s = Math.min(bw / im.width, bh / im.height);
  const w = im.width * s, h = im.height * s;
  const y = bottom ? cy + bh / 2 - h : cy - h / 2;
  ctx.drawImage(im, cx - w / 2, y, w, h);
}
/** 铺满（裁切） */
function drawCover(im: any, x: number, y: number, w: number, h: number, ay = 0.5) {
  const s = Math.max(w / im.width, h / im.height);
  const dw = im.width * s, dh = im.height * s;
  ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) * ay, dw, dh);
}
/** 有图画图，没图画 emoji */
function icon(key: string, emoji: string, cx: number, cy: number, fontSize: number, box: number) {
  const im = img(key);
  if (im) drawContain(im, cx, cy, box, box);
  else if (emoji) text(emoji, cx, cy, fontSize, '#000', 'center');
}
/** 圆形头像 + 金环 */
function avatar(key: string, emoji: string, cx: number, cy: number, r: number, ring = C.gold) {
  const im = img('avatar_' + key);
  ctx.beginPath(); ctx.arc(cx, cy, r + 2, 0, Math.PI * 2); ctx.fillStyle = ring; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#e9dfc8'; ctx.fill();
  if (!im) { text(emoji, cx, cy, r * 1.2, '#000', 'center'); return; }
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(im, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}
function cardArtKey(card: Card) {
  return card.kind === 'creature' ? card.type : card.kind === 'terrain' ? 'tile_' + card.type : 'item_' + card.type;
}
/** 卡牌主色：动物按稀有度，地形绿，道具琥珀 */
function cardColor(card: Card): string {
  if (card.kind === 'terrain') return '#5fbf7f';
  if (card.kind === 'item') return '#f0a54a';
  return ['#9fb6d8', '#9fb6d8', '#b58cff', '#ffcf5a'][CREATURES[card.type].r];
}
function diamond(cx: number, cy: number, r: number, color: string) {
  ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
}
/** 标题两侧的装饰线 */
function ornamentLine(cx: number, y: number, halfW: number, gap: number) {
  ctx.strokeStyle = C.line; ctx.lineWidth = 1;
  [[-1], [1]].forEach(([d]) => {
    ctx.beginPath(); ctx.moveTo(cx + d * gap, y); ctx.lineTo(cx + d * halfW, y); ctx.stroke();
    diamond(cx + d * (gap + 6), y, 3, C.crimson);
  });
}

// ---------- 场景 ----------
let petals: { x: number; y: number; s: number; v: number; r: number }[] = [];
for (let k = 0; k < 16; k++) petals.push({ x: (k * 97) % W, y: (k * 151) % H, s: 2 + (k % 3), v: 14 + (k % 5) * 5, r: k });
/** 宣纸底：有场景图就铺场景图，否则画纸纹 + 远山水墨 */
function drawBackground(dark = 0) {
  const bg = img('bg_scene');
  if (bg) drawScene(bg);
  else paperScene();
  if (dark > 0) { ctx.fillStyle = 'rgba(246,239,223,' + dark + ')'; ctx.fillRect(0, 0, W, H); }
  ctx.fillStyle = 'rgba(232,140,160,0.55)';
  petals.forEach((p) => {
    const x = ((p.x + clock * p.v * 0.6) % (W + 40)) - 20;
    const y = ((p.y + clock * p.v) % (H + 40)) - 20;
    ctx.beginPath(); ctx.ellipse(x, y, p.s * 1.6, p.s, (clock * 0.8 + p.r) % Math.PI, 0, Math.PI * 2); ctx.fill();
  });
}
/** 场景图里围栏草地的位置（按原图比例），把它对齐到棋盘外框：上下两段等比，中间草地纵向拉伸 */
const MEADOW = { x0: 0.075, x1: 0.925, top: 0.36, bottom: 0.685 };
function drawScene(bg: any) {
  const iw = bg.width, ih = bg.height;
  const fx = BOARD_X - BOARD_PAD, fy = BOARD_Y - BOARD_PAD, fw = CELL * COLS + BOARD_PAD * 2, fh = CELL * ROWS + BOARD_PAD * 2;
  const mx0 = MEADOW.x0 * iw, mx1 = MEADOW.x1 * iw, ft = MEADOW.top * ih, fb = MEADOW.bottom * ih;
  const s = Math.max((fw + 22) / (mx1 - mx0), W / iw);
  let dx = fx + fw / 2 - ((mx0 + mx1) / 2) * s;
  dx = Math.min(0, Math.max(W - iw * s, dx));
  const a = ft + 0.025 * ih, b = fb - 0.025 * ih;
  const ya = fy - 10 + (a - ft) * s;
  const yb = fy + fh + 10 - (fb - b) * s;
  const dw = iw * s;
  // 上段：不够高时整体略拉伸铺满顶部
  const topH = Math.max(a * s, ya);
  ctx.drawImage(bg, 0, 0, iw, a, dx, ya - topH, dw, topH);
  ctx.drawImage(bg, 0, a, iw, b - a, dx, ya, dw, yb - ya);
  const botH = Math.max((ih - b) * s, H - yb);
  ctx.drawImage(bg, 0, b, iw, ih - b, dx, yb, dw, botH);
}
function paperScene() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#f3ead6'); g.addColorStop(0.5, '#f8f2e4'); g.addColorStop(1, '#eee3cb');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 远山：三层淡墨
  const layers: [number, number, string][] = [[0.13, 34, 'rgba(120,140,130,0.16)'], [0.17, 26, 'rgba(90,110,100,0.18)'], [0.21, 18, 'rgba(70,86,78,0.16)']];
  layers.forEach(([base, amp, col], li) => {
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      const y = H * base + Math.sin(x / (60 + li * 23) + li * 2) * amp + Math.sin(x / 23 + li) * amp * 0.25;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  });
  // 下半是淡青草地
  const gr = ctx.createLinearGradient(0, H * 0.24, 0, H);
  gr.addColorStop(0, 'rgba(206,222,196,0.0)'); gr.addColorStop(0.15, 'rgba(206,222,196,0.55)'); gr.addColorStop(1, 'rgba(196,212,182,0.7)');
  ctx.fillStyle = gr; ctx.fillRect(0, H * 0.24, W, H);
  // 一轮淡朱砂日
  ctx.beginPath(); ctx.arc(W * 0.8, H * 0.09, 18, 0, Math.PI * 2); ctx.fillStyle = 'rgba(200,80,60,0.22)'; ctx.fill();
}

function muteButton(x: number, y: number) {
  ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fillStyle = 'rgba(252,247,235,0.92)'; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = C.line; ctx.stroke();
  text(muted ? '🔇' : '🔊', x, y + 1, 13, '#fff', 'center');
  hit(x - 18, y - 18, 36, 36, toggleMute);
}

function drawHUD() {
  const y = SAFE_TOP, h = TOP_H - 6;
  panel(PAD, y, W - PAD * 2, h, { c: 10 });
  // 左：周数和天数
  goldText('第' + game.week + '周', PAD + 46, y + 20, 19);
  const day = Math.min(game.day, DAYS_PER_WEEK);
  for (let d = 1; d <= DAYS_PER_WEEK; d++) {
    diamond(PAD + 46 + (d - 4) * 10, y + 42, d === day ? 4 : 2.8, d < day ? C.gold : d === day ? C.crimson : 'rgba(90,64,40,0.2)');
  }
  if (game.endless) text('无尽', PAD + 46, y + h + 8, 10, C.warn, 'center', true);
  // 右：粮草
  const rx = W - PAD - 104;
  text('🌾', rx + 14, y + 21, 18, '#000', 'center');
  goldText(String(game.coins), rx + 28, y + 21, 21, 'left', FONT);
  text('今晚 +' + game.previewIncome(), rx + 28, y + 42, 10.5, C.muted, 'left');
  // 中：诸侯与军粮进度
  const mx = PAD + 92, mw = rx - mx - 8;
  const rent = game.rentOf(), lord = game.lord;
  avatar(lord.art, lord.icon, mx + 12, y + h / 2, 11, C.crimson);
  const left = DAYS_PER_WEEK - day + 1;
  text(lord.name + ' 收军粮', mx + 28, y + 17, 11, C.cream, 'left', true);
  text('还剩' + left + '天', mx + mw, y + 17, 11, game.coins >= rent ? C.jade : C.warn, 'right', true);
  const bx = mx + 28, bw = mw - 28, bh = 12, by = y + 32;
  fillRR(bx, by, bw, bh, 6, 'rgba(90,64,40,0.14)');
  const ok = game.coins >= rent;
  const f = Math.max(0.03, Math.min(1, game.coins / Math.max(1, rent)));
  const pg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  if (ok) { pg.addColorStop(0, '#4f9e86'); pg.addColorStop(1, '#8cc9b2'); } else { pg.addColorStop(0, '#b8432f'); pg.addColorStop(1, '#e08a72'); }
  fillRR(bx, by, bw * f, bh, 6, pg as any);
  shadowText(game.coins + ' / ' + rent, bx + bw / 2, by + bh / 2 + 0.5, 9, C.ink, 'center', true);
}

function drawBoard() {
  const fx = BOARD_X - BOARD_PAD, fy = BOARD_Y - BOARD_PAD, fw = CELL * COLS + BOARD_PAD * 2, fh = CELL * ROWS + BOARD_PAD * 2;
  if (img('bg_scene')) fillRR(fx + 2, fy + 2, fw - 4, fh - 4, 10, 'rgba(70,90,40,0.10)');
  else panel(fx, fy, fw, fh, { c: 12, fill: 'rgba(238,228,204,0.92)' });
  // 伙伴头像挂在棋盘右上角外沿
  let rx = fx + fw - 14;
  for (let k = game.relics.length - 1; k >= 0; k--) {
    const id = game.relics[k];
    avatar(RELICS[id].art, RELICS[id].icon, rx, fy, 10);
    hit(rx - 12, fy - 12, 24, 24, () => game.tapRelicIcon(id));
    rx -= 24;
  }
  const sel = game.selectedCard;
  const pulse = 0.55 + 0.45 * Math.sin(clock * 5);
  game.board.forEach((cell, i) => {
    const x = BOARD_X + (i % COLS) * CELL, y = BOARD_Y + Math.floor(i / COLS) * CELL;
    const t = TERRAINS[cell.terrain];
    const tile = img('tile_' + cell.terrain);
    const g = 2, r = 7;
    ctx.save(); rr(x + g, y + g, CELL - g * 2, CELL - g * 2, r); ctx.clip();
    if (tile) ctx.drawImage(tile, x + g, y + g, CELL - g * 2, CELL - g * 2);
    else { ctx.fillStyle = t.color; ctx.fillRect(x, y, CELL, CELL); }
    // 压暗一点，再加内阴影和顶部高光，让格子更有质感
    const sh = ctx.createLinearGradient(0, y, 0, y + CELL);
    sh.addColorStop(0, 'rgba(255,255,255,0.10)'); sh.addColorStop(0.5, 'rgba(0,0,0,0.05)'); sh.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = sh; ctx.fillRect(x, y, CELL, CELL);
    if (cell.terrain === 'wild') { ctx.fillStyle = 'rgba(40,24,30,0.38)'; ctx.fillRect(x, y, CELL, CELL); }
    ctx.restore();
    rr(x + g + 0.5, y + g + 0.5, CELL - g * 2 - 1, CELL - g * 2 - 1, r);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(70,50,30,0.35)'; ctx.stroke();
    if (sel && game.canPlace(sel, cell, true)) {
      const repl = sel.kind === 'creature' && !!cell.c;
      ctx.save();
      ctx.shadowColor = 'rgba(184,67,47,' + pulse * 0.8 + ')'; ctx.shadowBlur = 10;
      rr(x + g + 1, y + g + 1, CELL - g * 2 - 2, CELL - g * 2 - 2, r);
      ctx.lineWidth = repl ? 1.5 : 2.5;
      ctx.strokeStyle = repl ? 'rgba(184,67,47,' + (0.35 + pulse * 0.4) + ')' : 'rgba(255,250,236,' + (0.6 + pulse * 0.4) + ')';
      if (repl) ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

    }
    if (cell.c) {
      // 换位置：先停在原处（等夜里的收入数字飘完），再跳到新格子
      const id = cell.c.id;
      const prev = cellOfId[id];
      if (prev !== undefined && prev !== i && !hops[id]) hops[id] = { from: prev, start: Math.max(clock, waitUntil) + (i % 5) * 0.04 };
      cellOfId[id] = i;
      let ox = 0, oy = 0, lift = 0;
      const hop = hops[id];
      if (hop) {
        const fc = cellCenter(hop.from), tc = cellCenter(i);
        const t = Math.max(0, Math.min(1, (clock - hop.start) / 0.45));
        const e = t * t * (3 - 2 * t);
        ox = (fc.x - tc.x) * (1 - e); oy = (fc.y - tc.y) * (1 - e);
        lift = Math.sin(Math.PI * t) * CELL * 0.35;
        if (t >= 1) delete hops[id];
      }
      // 地面阴影（跳起来时变小变淡）
      const sk = 1 - Math.min(0.6, lift / CELL);
      ctx.beginPath(); ctx.ellipse(x + CELL / 2 + ox, y + CELL * 0.84 + oy, CELL * 0.28 * sk, CELL * 0.07 * sk, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,' + (0.28 * sk) + ')'; ctx.fill();
      const pt = clock - (popAt[i] || -9);
      const k = pt < 0.35 ? popScale(pt / 0.35) : 1;
      const bob = hop ? 0 : Math.sin(clock * 2 + i) * 0.8;
      moving.push(() => icon(cell.c!.type, CREATURES[cell.c!.type].icon, x + CELL / 2 + ox, y + CELL / 2 + bob + oy - lift + (1 - k) * 6, Math.floor(CELL * 0.5 * k), CELL * 0.84 * k));
      if (!hop) moving.pop()!();
      if (cell.c.bonus > 0) {
        diamond(x + 11, y + 11, 8, C.violet);
        text('+' + cell.c.bonus, x + 11, y + 11.5, 8, '#fff', 'center', true);
      }
      if (cell.c.last !== null) {
        const s = String(cell.c.last);
        ctx.font = 'bold 10px ' + FONT;
        const bw = Math.max(20, ctx.measureText(s).width + 10);
        chamfer(x + CELL - bw - 3, y + CELL - 17, bw, 14, 4);
        ctx.fillStyle = 'rgba(252,247,235,0.95)'; ctx.fill();
        ctx.lineWidth = 0.8; ctx.strokeStyle = C.line; ctx.stroke();
        text(s, x + CELL - 3 - bw / 2, y + CELL - 9.5, 10, C.crimson, 'center', true);
      }
    }
    if (game.pendingReplace === i && sel) {
      ctx.fillStyle = 'rgba(20,10,20,0.45)'; ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
      chamfer(x + 5, y + CELL / 2 - 11, CELL - 10, 22, 5); ctx.fillStyle = 'rgba(192,58,76,0.95)'; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = C.gold; ctx.stroke();
      text('点击替换', x + CELL / 2, y + CELL / 2, 11, '#fff', 'center', true);
    }
    hit(x, y, CELL, CELL, () => game.tapCell(i));
  });
  moving.forEach((f) => f());
  moving = [];
}
const cellOfId: Record<number, number> = {};
const hops: Record<number, { from: number; start: number }> = {};
let moving: (() => void)[] = [];

/** 新放下的动物弹一下：0→1 时略微超出再回落 */
function popScale(t: number) { const c = 1.7; const u = t - 1; return Math.max(0.05, 1 + (c + 1) * u * u * u + c * u * u); }

/** 主角头像 + 对话框，显示提示 */
function drawInfo() {
  const x = PAD, y = INFO_Y, w = W - PAD * 2, h = INFO_H;
  panel(x + 26, y, w - 26, h, { c: 8, corners: false });
  const hero = img('avatar_heroine') || null;
  const ar = 27;
  ctx.beginPath(); ctx.arc(x + ar + 2, y + h / 2, ar + 2.5, 0, Math.PI * 2); ctx.fillStyle = C.gold; ctx.fill();
  ctx.beginPath(); ctx.arc(x + ar + 2, y + h / 2, ar, 0, Math.PI * 2); ctx.fillStyle = '#e9dfc8'; ctx.fill();
  if (hero) {
    ctx.save(); ctx.beginPath(); ctx.arc(x + ar + 2, y + h / 2, ar, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(hero, x + 2, y + h / 2 - ar, ar * 2, ar * 2); ctx.restore();
  } else text('🌸', x + ar + 2, y + h / 2, 24, '#000', 'center');
  ctx.font = '13.5px ' + FONT;
  const lines = ctx.measureText(game.info).width > w - ar * 2 - 26 ? 2 : 1;
  wrap(game.info, x + ar * 2 + 14, y + h / 2 - (lines - 1) * 10, w - ar * 2 - 26, 13.5, C.cream, 20, 2);
}

/** 每天早上弹出的选卡窗：三张大卡居中，下方刷新 / 跳过 */
let cardModal = true;
let dayKey = '';
function drawCardModal() {
  const n = game.choices.length;
  dim(0.62);
  hit(0, 0, W, BTN_Y - 4, () => { cardModal = false; }, '收起');
  const gap = 8;
  const cw = Math.floor((W - PAD * 2 - gap * (n - 1)) / n);
  const ch = Math.min(H * 0.52, 380);
  const cy = Math.max(SAFE_TOP + TOP_H + 50, (H - ch) / 2 - 30);
  goldText(game.picksLeft > 1 ? '今天还能选 ' + game.picksLeft + ' 张' : '选一张卡', W / 2, cy - 26, 24);
  ornamentLine(W / 2, cy - 26, W * 0.46, 92);
  game.choices.forEach((card, k) => {
    const x = PAD + k * (cw + gap), y = cy;
    const info = cardInfo(card);
    const col = cardColor(card);
    panel(x, y, cw, ch, { c: 10, corners: false, fill: 'rgba(251,246,234,0.98)' });
    // 顶部名字条
    chamfer(x + 4, y + 4, cw - 8, 30, 6);
    const hg = ctx.createLinearGradient(0, y + 4, 0, y + 34);
    hg.addColorStop(0, col); hg.addColorStop(1, 'rgba(60,40,20,0.25)');
    ctx.fillStyle = hg; ctx.fill();
    text(info.name, x + cw / 2, y + 20, 15, '#fff', 'center', true, SERIF);
    // 画面
    const ah = Math.min(ch * 0.36, cw * 1.05);
    const rg = ctx.createRadialGradient(x + cw / 2, y + 38 + ah / 2, 4, x + cw / 2, y + 38 + ah / 2, cw * 0.6);
    rg.addColorStop(0, 'rgba(200,180,140,0.28)'); rg.addColorStop(1, 'rgba(200,180,140,0)');
    ctx.fillStyle = rg; ctx.fillRect(x, y + 38, cw, ah);
    icon(cardArtKey(card), info.icon || '⬛', x + cw / 2, y + 38 + ah / 2, 40, Math.min(cw - 10, ah - 4));
    // 标签 + 收益
    ctx.font = 'bold 10px ' + FONT;
    const tw = Math.min(cw - 8, ctx.measureText(info.tag).width + 16);
    chamfer(x + cw / 2 - tw / 2, y + 40 + ah, tw, 17, 5); ctx.fillStyle = 'rgba(60,44,30,0.82)'; ctx.fill();
    text(info.tag, x + cw / 2, y + 48.5 + ah, 10, col, 'center', true);
    // 规则：大字，数字高亮
    const ry = y + 68 + ah;
    fillRR(x + 6, ry - 6, cw - 12, ch - (ry - y) - 2, 6, 'rgba(120,90,50,0.07)');
    richWrap(info.desc, x + cw / 2, ry + 10, cw - 20, 13, 19, Math.max(2, Math.floor((ch - (ry - y) - 14) / 19)));
    hit(x, y, cw, ch, () => pickCard(k), info.name);
  });
  const by = cy + ch + 18, bw = (W - PAD * 2 - 12) / 2;
  button('🔄 刷新 🌾' + game.rerollCost, PAD, by, bw, 46, () => game.reroll(), 'violet', game.canReroll(), 15);
  button('跳过', PAD + bw + 12, by, bw, 46, () => { game.skipCards(); }, 'ghost', true, 15);
  shadowText('动物会自动上场；地形和道具选好后再点格子', W / 2, by + 66, 12, C.cream, 'center');
}
/** 把说明里的数字和关键词标成金色 */
function richWrap(s: string, cx: number, y: number, maxW: number, size: number, lineH: number, maxLines: number) {
  ctx.font = size + 'px ' + FONT;
  const lines: string[] = [];
  let line = '';
  for (const ch of Array.from(s)) {
    if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; } else line += ch;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…'; }
  const key = /[+＋-]?\d+%?|永久|水塘|草地|花田|森林|岩洞|吃掉|守护/g;
  lines.forEach((l, k) => {
    const w = ctx.measureText(l).width;
    let x = cx - w / 2;
    const yy = y + k * lineH;
    let last = 0;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    l.replace(key, (m, idx: number) => {
      const before = l.slice(last, idx);
      ctx.font = size + 'px ' + FONT; ctx.fillStyle = C.cream; ctx.fillText(before, x, yy); x += ctx.measureText(before).width;
      ctx.font = 'bold ' + size + 'px ' + FONT; ctx.fillStyle = /\d/.test(m) ? C.crimson : C.jade; ctx.fillText(m, x, yy); x += ctx.measureText(m).width;
      last = idx + m.length;
      return m;
    });
    const rest = l.slice(last);
    ctx.font = size + 'px ' + FONT; ctx.fillStyle = C.cream; ctx.fillText(rest, x, yy);
  });
}
function pickCard(k: number) {
  const card = game.choices[k];
  if (!card) return;
  game.tapCard(k);
  if (card.kind === 'creature') return; // 动物已经自动上场或进了候选池
  if (card.kind === 'item' && ITEMS[card.type].target === 'none') { game.tapCard(k); return; }
  cardModal = false;
}
/** 选好卡、还没放下时，在底部显示「换一张」 */
/** 候选池：牧场满了时等着上场的动物 */
function drawPool() {
  const pool = game.pool;
  if (game.mode !== 'play' && game.mode !== 'rent') return;
  if (!pool.length) return;
  const x = PAD, y = INFO_Y - 46, h = 36;
  const show = Math.min(pool.length, 5);
  const w = 62 + show * 30 + (pool.length > show ? 26 : 0);
  panel(x, y, w, h, { c: 6, corners: false });
  text('候选池', x + 10, y + h / 2, 11, C.cream, 'left', true, SERIF);
  for (let k = 0; k < show; k++) {
    const c = pool[k];
    icon(c.type, CREATURES[c.type].icon, x + 66 + k * 30, y + h / 2, 18, 28);
  }
  if (pool.length > show) text('+' + (pool.length - show), x + 66 + show * 30 + 2, y + h / 2, 11, C.crimson, 'left', true);
  hit(x, y, w, h, () => {
    game.info = '候选池（' + pool.length + '/' + POOL_MAX + '）：' + pool.map((c) => CREATURES[c.type].name).join('、') + '。明早会和场上动物一起随机上场。';
  }, '候选池');
}

function drawPickBar() {
  if (game.mode !== 'play' || !game.choices.length) return;
  if (game.selected >= 0) {
    button('换一张卡', W - PAD - 108, INFO_Y - 46, 108, 36, () => { game.deselect(); cardModal = true; }, 'ghost', true, 13);
  } else if (!cardModal) {
    button('查看今天的卡', W - PAD - 128, INFO_Y - 46, 128, 36, () => { cardModal = true; }, 'gold', true, 13);
  }
}

function dim(alpha = 0.5) {
  ctx.fillStyle = 'rgba(58,44,30,' + Math.min(0.85, alpha * 0.95) + ')';
  ctx.fillRect(0, 0, W, H);
}

/** 收军粮：诸侯立绘 + 视觉小说式对话框 */
function drawRent() {
  dim(0.72);
  const lord = game.lord;
  const rent = game.rentOf();
  const ok = game.coins >= rent;
  const boxH = 216;
  const boxY = H - SAFE_BOTTOM - boxH - 14;
  // 背后的光
  const lg = ctx.createRadialGradient(W / 2, boxY - 120, 10, W / 2, boxY - 120, W * 0.8);
  lg.addColorStop(0, 'rgba(192,58,76,0.45)'); lg.addColorStop(1, 'rgba(192,58,76,0)');
  ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
  const portrait = img(lord.art);
  const ph = Math.min(H * 0.66, boxY - SAFE_TOP + 40);
  if (portrait) drawContain(portrait, W / 2, boxY + 40 - ph / 2, W * 1.1, ph, true);
  else text(lord.icon, W / 2, boxY - 90, 90, '#000', 'center');
  panel(PAD, boxY, W - PAD * 2, boxH, { c: 12 });
  const last = game.week === game.weeks && !game.endless;
  chamfer(PAD + 14, boxY - 18, 132, 34, 8);
  const ng = ctx.createLinearGradient(0, boxY - 18, 0, boxY + 16);
  ng.addColorStop(0, '#d8566a'); ng.addColorStop(1, '#8c2032');
  ctx.fillStyle = ng; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = C.gold; ctx.stroke();
  text((last ? '最终关 · ' : '') + lord.name, PAD + 80, boxY - 1, 16, '#fff6e6', 'center', true, SERIF);
  wrap('「' + lord.line + '」', PAD + 20, boxY + 36, W - PAD * 2 - 40, 15, C.cream, 22, 2);
  // 军粮对比
  const by = boxY + 96;
  text('第' + game.week + '周军粮', PAD + 20, by, 12, C.muted);
  goldText(String(rent), PAD + 20, by + 22, 22, 'left', FONT);
  text('你的粮草', W - PAD - 20, by, 12, C.muted, 'right');
  ctx.save(); text(String(game.coins), W - PAD - 20, by + 22, 22, ok ? C.ok : C.warn, 'right', true); ctx.restore();
  button(ok ? '交出军粮' : '交不起……', PAD + 20, boxY + boxH - 66, W - PAD * 2 - 40, 50, () => game.payRent(), ok ? 'gold' : 'ghost', true, 18);
}

/** 三选一招募伙伴：三张竖卡，上半是立绘 */
function drawRelic() {
  drawBackground(0.55);
  const top = SAFE_TOP + 4;
  goldText('招募伙伴', W / 2, top + 18, 26);
  ornamentLine(W / 2, top + 18, W * 0.46, 70);
  text(game.lord.name + '满意地走了，有人想加入你的牧场', W / 2, top + 48, 13, C.muted, 'center');
  const gap = 8;
  const cw = Math.floor((W - PAD * 2 - gap * 2) / 3);
  const avail = H - top - 120 - SAFE_BOTTOM;
  const ch = Math.min(avail, 500);
  const cy = top + 72 + Math.max(0, (avail - ch) / 2);
  game.relicChoices.forEach((k, idx) => {
    const r = RELICS[k];
    const x = PAD + idx * (cw + gap);
    panel(x, cy, cw, ch, { c: 10, corners: false, fill: 'rgba(251,246,234,0.98)' });
    const ph = ch - 118;
    ctx.save(); chamfer(x + 3, cy + 3, cw - 6, ph, 8); ctx.clip();
    const bg = ctx.createLinearGradient(0, cy, 0, cy + ph);
    bg.addColorStop(0, '#e6dcc4'); bg.addColorStop(0.7, '#efd9cf'); bg.addColorStop(1, '#f6efdf');
    ctx.fillStyle = bg; ctx.fillRect(x, cy, cw, ph + 4);
    const p = img(r.art);
    if (p) drawCover(p, x + 3, cy + 6, cw - 6, ph + 20, 0);
    else text(r.icon, x + cw / 2, cy + ph / 2, 40, '#000', 'center');
    const fade = ctx.createLinearGradient(0, cy + ph * 0.7, 0, cy + ph + 3);
    fade.addColorStop(0, 'rgba(251,246,234,0)'); fade.addColorStop(1, 'rgba(251,246,234,1)');
    ctx.fillStyle = fade; ctx.fillRect(x, cy + ph * 0.7, cw, ph * 0.3 + 4);
    ctx.restore();
    goldText(r.name, x + cw / 2, cy + ph + 2, 19);
    text('「' + r.title + '」', x + cw / 2, cy + ph + 26, 11, '#8a5a7e', 'center', false, SERIF);
    wrap(r.desc, x + cw / 2, cy + ph + 48, cw - 14, 11, C.muted, 15, 4, 'center');
    hit(x, cy, cw, ch, () => game.chooseRelic(k));
  });
  shadowText('点卡片招募', W / 2, cy + ch + 24, 13, C.gold, 'center', true, SERIF);
}

function drawEnd(win: boolean) {
  dim(0.75);
  const ph = (win ? 330 : 280) + (game.star ? 44 : 0);
  const py = H - SAFE_BOTTOM - ph - 20;
  const who = win ? img('heroine') : img(game.lord.art);
  if (who) drawContain(who, W / 2, py - (H * 0.5) / 2 + 30, W, H * 0.5, true);
  panel(20, py, W - 40, ph, { c: 12 });
  const title = win ? '世外桃源' : game.endless ? '无尽挑战结束' : '牧场失守';
  goldText(title, W / 2, py + 34, 26);
  ornamentLine(W / 2, py + 34, W * 0.4, 80);
  const sub = win ? '乱世之中，你的牧场成了世外桃源！'
    : game.endless ? '撑过了 ' + game.weeksSurvived + ' 周，真了不起！'
    : '粮草不够，牧场被' + game.lord.name + '收走了……';
  text(sub, W / 2, py + 66, 13, C.cream, 'center');
  // 三格数据
  const stats: [string, string][] = [['撑过', game.weeksSurvived + '周'], ['伙伴', game.relics.length + '位'], ['总收获', String(game.total)]];
  const sw = (W - 80) / 3;
  stats.forEach(([k, v], i) => {
    const sx = 40 + i * sw;
    text(k, sx + sw / 2, py + 94, 11, C.muted, 'center');
    goldText(v, sx + sw / 2, py + 116, 19, 'center', FONT);
  });
  text('最好成绩 ' + game.best + ' 周', W / 2, py + 142, 11, C.muted, 'center');
  let sy = py + 166;
  if (game.star) {
    // 最强一只：方便截图炫耀
    const st = game.star;
    fillRR(40, sy - 6, W - 80, 40, 8, 'rgba(184,67,47,0.08)');
    icon(st.type, CREATURES[st.type].icon, 66, sy + 14, 22, 36);
    text('最强一只', 92, sy + 5, 11, C.muted, 'left');
    text(CREATURES[st.type].name + ' · 一晚产出 ' + st.v, 92, sy + 23, 15, C.crimson, 'left', true, SERIF);
    sy += 44;
  }
  let ax = W / 2 - (game.relics.length - 1) * 13;
  game.relics.forEach((id) => { avatar(RELICS[id].art, RELICS[id].icon, ax, sy, 10); ax += 26; });
  const bw = W - 96;
  let by = sy + 24;
  if (win) {
    button('继续挑战（无尽模式）', 48, by, bw, 46, () => game.continueEndless(), 'crimson');
    by += 56;
  }
  const canShare = !!wx.shareAppMessage;
  const half = canShare ? (bw - 10) / 2 : bw;
  button('再来一局', 48, by, half, 46, () => game.newGame(), 'gold');
  if (canShare) button('分享战绩', 48 + half + 10, by, half, 46, () => shareResult(), 'violet');
}

function shareResult() {
  const t = game.mode === 'win'
    ? '我在' + GAME_TITLE + '撑过了全部 8 周，牧场成了世外桃源！你也来试试？'
    : '我在' + GAME_TITLE + '撑过了 ' + game.weeksSurvived + ' 周，你能坚持多久？';
  try { wx.shareAppMessage({ title: t }); } catch (e) { /* ignore */ }
}

function drawTitle() {
  const tb = img('bg_title');
  if (tb) { drawCover(tb, 0, 0, W, H, 0.4); ctx.fillStyle = 'rgba(246,239,223,0.35)'; ctx.fillRect(0, 0, W, H); } else drawBackground();
  // 底部渐暗，托住标题和按钮
  const fade = ctx.createLinearGradient(0, H * 0.42, 0, H);
  fade.addColorStop(0, 'rgba(246,239,223,0)'); fade.addColorStop(0.45, 'rgba(246,239,223,0.82)'); fade.addColorStop(1, 'rgba(240,231,210,0.96)');
  ctx.fillStyle = fade; ctx.fillRect(0, 0, W, H);
  const hero = img('heroine');
  const ph = H * 0.56;
  if (hero) {
    ctx.save(); ctx.shadowColor = 'rgba(120,80,50,0.25)'; ctx.shadowBlur = 18;
    drawContain(hero, W / 2, SAFE_TOP + ph / 2 - 6, W * 1.05, ph, true);
    ctx.restore();
  } else text('🌸', W / 2, SAFE_TOP + ph / 2, 72, '#000', 'center');
  const ty = SAFE_TOP + ph + 22;
  goldText(GAME_TITLE, W / 2, ty, 46);
  ornamentLine(W / 2, ty + 34, W * 0.42, 6);
  shadowText('乱世之中，和三国美少女们一起经营牧场', W / 2, ty + 54, 13, C.cream, 'center', false, SERIF);
  if (game.best) text('最好成绩 · 撑过 ' + game.best + ' 周', W / 2, ty + 76, 11, C.gold, 'center');
  const run = savedRun();
  const bw = Math.min(260, W - 80);
  const by = Math.min(H - SAFE_BOTTOM - (run ? 124 : 72), ty + 96);
  if (run) {
    button('继续上局', W / 2 - bw / 2, by, bw, 52, () => { if (!game.load(run)) game.newGame(); }, 'gold', true, 19);
    button('重新开始', W / 2 - bw / 2, by + 62, bw, 44, () => game.newGame(), 'ghost', true, 15);
  } else {
    button('开始经营', W / 2 - bw / 2, by, bw, 54, () => game.newGame(), 'gold', true, 20);
  }
  // 玩法说明收进右上角的小按钮
  muteButton(W - PAD - 16, SAFE_TOP + 16);
  const hx = PAD + 16, hy = SAFE_TOP + 16;
  ctx.beginPath(); ctx.arc(hx, hy, 14, 0, Math.PI * 2); ctx.fillStyle = 'rgba(252,247,235,0.92)'; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = C.line; ctx.stroke();
  text('?', hx, hy + 1, 15, C.gold, 'center', true);
  hit(hx - 18, hy - 18, 36, 36, () => { showHelp = !showHelp; }, '玩法');
  if (showHelp) drawHelp();
}
let showHelp = false;
function drawHelp() {
  dim(0.6);
  const w = W - 48, h = 380, x = 24, y = (H - h) / 2;
  panel(x, y, w, h, { c: 12 });
  goldText('玩法', W / 2, y + 30, 22);
  ornamentLine(W / 2, y + 30, w * 0.4, 44);
  [
    '每天从卡牌里选一张：动物、地形或道具',
    '动物看地形和周围邻居产出粮草；每天早上动物们会随机换位置',
    '每 7 天有诸侯来收军粮，交不起牧场就没了',
    '交完军粮招一位伙伴，撑过 8 周即通关',
    '动物分田园、溪畔、山林、灵兽四家，同家族挨着每只+1',
    '狐狸、夜枭、小云龙会吃邻居并继承它一半产出；牧羊犬旁边不会被吃',
    '选了动物会自动落到空位；格子满了就进候选池，第二天早上和场上动物一起随机上场',
  ].forEach((l, k) => {
    diamond(x + 24, y + 70 + k * 40, 3.5, C.gold);
    wrap(l, x + 36, y + 70 + k * 40, w - 52, 13, C.cream, 18, 2);
  });
  hit(0, 0, W, H, () => { showHelp = false; });
}

function playFx() {
  const list = game.fx;
  game.fx = [];
  list.forEach((f) => {
    const p = f.cell >= 0 ? cellCenter(f.cell) : { x: W / 2, y: INFO_Y };
    floats.push({ x: p.x, y: p.y - 8, text: f.text, color: f.color, t: 0 });
  });
}
function drawFloats(dt: number) {
  floats = floats.filter((f) => (f.t += dt) < 1.3);
  floats.forEach((f) => {
    ctx.globalAlpha = Math.max(0, 1 - f.t / 1.3);
    const sc = f.t < 0.15 ? 0.6 + f.t / 0.15 * 0.5 : 1.1 - Math.min(0.1, (f.t - 0.15));
    ctx.font = 'bold ' + Math.round(17 * sc) + 'px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(30,16,8,0.9)';
    ctx.strokeText(f.text, f.x, f.y - f.t * 34);
    ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y - f.t * 34);
  });
  ctx.globalAlpha = 1;
}

// ---------- 主循环 ----------
let lastT = 0;
function frame(ts?: number) {
  const now = ts || Date.now();
  const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0.016;
  lastT = now;
  clock += dt;
  buttons = [];
  playFx();
  if (game.mode === 'title') {
    drawTitle();
  } else {
    drawBackground();
    const k = game.week + '-' + game.day;
    if (k !== dayKey) { dayKey = k; cardModal = true; }
    drawHUD();
    drawBoard();
    drawInfo();
    drawPickBar();
    drawPool();
    muteButton(PAD + 18, BTN_Y + BTN_H / 2);
    button('🌙 结束今天', PAD + 42, BTN_Y, W - PAD * 2 - 42, BTN_H, endDay, game.choices.length ? 'violet' : 'gold', game.canEndDay() && clock >= waitUntil, 18);
    if (game.mode === 'play' && cardModal && game.choices.length && game.selected < 0 && clock >= waitUntil + 0.7) drawCardModal();
    drawFloats(dt);
    if (clock >= waitUntil) {
      if (game.mode === 'rent') drawRent();
      else if (game.mode === 'relic') drawRelic();
      else if (game.mode === 'over' || game.mode === 'win') drawEnd(game.mode === 'win');
    }
  }
  requestAnimationFrame(frame);
}

function endDay() {
  sfx('night');
  // 先让收入数字飘一会儿，再让动物跳到新位置、弹出新一天的卡
  waitUntil = clock + (game.endDay() ? 0.9 : 0.6);
  saveRun();
}

/** 根据一次点击前后的变化放音效、震动和弹出动画 */
function feedback(before: string, coins: number, cells: string[]) {
  const m = game.mode;
  if (m !== before) {
    if (before === 'rent') { if (m === 'relic' || m === 'play') { sfx('pay'); buzz(true); } else if (m === 'win') { sfx('win'); buzz(true); } else { sfx('fail'); buzz(true); } return; }
    if (before === 'relic' || (before === 'win' && m === 'relic')) { sfx('recruit'); return; }
    sfx('tap'); return;
  }
  let changed = false;
  const oldIds = cells.map((x) => { const o = x ? JSON.parse(x) : null; return o && o.c ? o.c.id : -1; });
  game.board.forEach((c, i) => {
    if (JSON.stringify(c) === cells[i]) return;
    changed = true;
    // 只有新来的动物弹一下；换位置的动物由 drawBoard 做跳跃动画
    if (c.c && oldIds.indexOf(c.c.id) < 0) popAt[i] = clock;
  });
  if (changed) { sfx('place'); buzz(); }
  if (game.coins > coins) sfx('coin');
  else if (!changed) sfx('tap');
}

wx.onTouchStart((e: any) => {
  const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
  if (!t) return;
  const x = t.clientX, y = t.clientY;
  for (let k = buttons.length - 1; k >= 0; k--) {
    const b = buttons[k];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      const before = game.mode, coins = game.coins, nChoices = game.choices.length;
      const cells = game.board.map((c) => JSON.stringify(c));
      b.onTap();
      feedback(before, coins, cells);
      if (game.choices.length < nChoices && game.selected < 0) cardModal = true;
      if ((game.mode === 'over' || game.mode === 'win') && before !== game.mode) {
        try { wx.setStorageSync(STORAGE_KEY, game.best); } catch (e) { /* ignore */ }
      }
      saveRun();
      return;
    }
  }
  if (game.mode === 'play' && game.selected >= 0) { game.deselect(); cardModal = true; }
});

try {
  if (wx.showShareMenu) wx.showShareMenu({ withShareTicket: false });
  if (wx.onShareAppMessage) wx.onShareAppMessage(() => ({ title: '乱世之中，来' + GAME_TITLE + '和三国美少女们一起放牧吧！' }));
} catch (e) { /* ignore */ }

try { if (wx.onHide) wx.onHide(saveRun); } catch (e) { /* ignore */ }

loadImages();
loadSounds();
requestAnimationFrame(frame);

// 方便浏览器里调试
(globalThis as any).__game = game;
(globalThis as any).__buttons = () => buttons;

// 新开一局或读档时，清掉换位置动画的记录，免得旧编号的动物乱跳
function resetHops() { for (const k in cellOfId) delete cellOfId[k]; for (const k in hops) delete hops[k]; }
const _newGame = game.newGame.bind(game);
game.newGame = () => { resetHops(); _newGame(); };
const _load = game.load.bind(game);
game.load = (s: string) => { resetHops(); return _load(s); };
