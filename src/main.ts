// 群芳牧场 —— 微信小游戏（原生 Canvas 2D，无引擎）
// 规则在 core/，这里只负责绘制和触摸。浏览器试玩时由 web/index.html 提供一个简化版 wx。
import { COLS, ROWS, DAYS_PER_WEEK, TERRAINS, CREATURES, RELICS, ITEMS, FAMILIES, cardInfo, Card, RelicId } from './core/Data';
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
const HERO_H = H < 720 ? 104 : 122;   // 顶部青玉粮草卡
const DAYS_H = 28;                     // 七日胶囊
const TOP_H = HERO_H + 8 + DAYS_H;
const BOARD_PAD = 8;                  // 奶白棋盘卡内边距
const LEGEND_H = 24;                   // 卡底家族图例
const INFO_H = 60;
const BTN_H = 56;
const BTN_Y = H - SAFE_BOTTOM - BTN_H - 14;
const INFO_Y = BTN_Y - 12 - INFO_H;
const BOARD_TOP = SAFE_TOP + TOP_H + 12;
const BOARD_AVAIL = INFO_Y - 12 - BOARD_TOP - BOARD_PAD * 2 - LEGEND_H;
const CELL = Math.floor(Math.min((W - PAD * 2 - BOARD_PAD * 2) / COLS, BOARD_AVAIL / ROWS));
const BOARD_X = Math.floor((W - CELL * COLS) / 2);
const BOARD_Y = Math.floor(BOARD_TOP + BOARD_PAD + Math.max(0, BOARD_AVAIL - CELL * ROWS) * 0.4);

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
  // 深色漆底上的文字
  lacq: '#f6e7c4', lacqMuted: 'rgba(246,231,196,0.62)', brass: '#e2bc6a',
};
const SERIF = '"Songti SC","STSongti-SC-Bold","Noto Serif SC","Source Han Serif SC","Noto Serif CJK SC","STSong",serif';

// ---------- 绘制工具 ----------
function rr(x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
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
/** 金属渐变：金、银、铜、玉，用于边框和描边 */
type Metal = 'gold' | 'silver' | 'bronze' | 'jade' | 'red';
const METALS: Record<Metal, string[]> = {
  gold: ['#fff2c8', '#e3bd6b', '#9a6a2a', '#f4d68f', '#7a531f'],
  silver: ['#ffffff', '#d3dae0', '#7d8892', '#eef2f5', '#646d75'],
  bronze: ['#f2cfa2', '#bd8250', '#74441f', '#d49a62', '#56311a'],
  jade: ['#e8fff5', '#85cfb2', '#2f7a62', '#ace0ca', '#225a48'],
  red: ['#ffb8a0', '#d9533c', '#8e1f16', '#e8735a', '#6a140c'],
};
function metal(kind: Metal, x0: number, y0: number, x1: number, y1: number) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  const s = METALS[kind];
  [0, 0.28, 0.5, 0.72, 1].forEach((p, k) => g.addColorStop(p, s[k]));
  return g;
}
/** 祥云角花：角在原点，两条云尾沿 +x、+y 伸出 */
function cloudCorner(x: number, y: number, s: number, rot: number, color: string | CanvasGradient = C.gold) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(1, s * 0.16); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(s, s, s * 0.62, Math.PI * 0.55, Math.PI * 2.05); ctx.stroke();
  ctx.beginPath(); ctx.arc(s * 1.05, s * 1.05, s * 0.26, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(s * 1.62, s); ctx.quadraticCurveTo(s * 2.3, s * 0.35, s * 3.3, s * 0.18); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s, s * 1.62); ctx.quadraticCurveTo(s * 0.35, s * 2.3, s * 0.18, s * 3.3); ctx.stroke();
  ctx.restore();
}
function corners4(x: number, y: number, w: number, h: number, s: number, color: string | CanvasGradient) {
  cloudCorner(x, y, s, 0, color);
  cloudCorner(x + w, y, s, Math.PI / 2, color);
  cloudCorner(x + w, y + h, s, Math.PI, color);
  cloudCorner(x, y + h, s, -Math.PI / 2, color);
}
// ---- 方向三「青玉大数字」：圆角卡片 + 青玉主色 + 米黄点缀 ----
const J = { jade: '#2f7d6b', jade2: '#1f5c4e', jadeHi: '#3a937e', rice: '#f6e7b8', cream: '#fffaf0', ink: '#1f2b27', inkSoft: '#5d6b65', red: '#c2412a', mist: '#cfe3db' };
interface PanelOpt { c?: number; fill?: string | CanvasGradient; corners?: boolean; glow?: string; frame?: Metal; dark?: boolean; r?: number; }
/** 卡片：奶白（或青玉）圆角卡 + 柔和投影 */
function panel(x: number, y: number, w: number, h: number, opt: PanelOpt = {}) {
  const r = opt.r !== undefined ? opt.r : Math.min(22, h / 3);
  ctx.save();
  if (opt.glow) { ctx.shadowColor = opt.glow; ctx.shadowBlur = 20; }
  else { ctx.shadowColor = 'rgba(31,43,39,0.18)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 5; }
  rr(x, y, w, h, r);
  if (opt.fill) ctx.fillStyle = opt.fill;
  else if (opt.dark) { const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, J.jadeHi); g.addColorStop(1, J.jade); ctx.fillStyle = g; }
  else ctx.fillStyle = 'rgba(255,250,240,0.97)';
  ctx.fill();
  ctx.restore();
}
/** 青玉小卡：数据块用 */
function lacquer(x: number, y: number, w: number, h: number, r = 12) {
  ctx.save();
  ctx.shadowColor = 'rgba(31,92,78,0.3)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
  rr(x, y, w, h, r);
  const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, J.jadeHi); g.addColorStop(1, J.jade);
  ctx.fillStyle = g; ctx.fill();
  ctx.restore();
}
/** 标题胶囊（替代飘带） */
function ribbon(cx: number, y: number, w: number, h: number, label: string, size = 20, kind: Metal = 'red') {
  ctx.font = 'bold ' + size + 'px ' + SERIF;
  const tw = Math.max(w * 0.7, ctx.measureText(label).width + h * 1.4);
  ctx.save();
  ctx.shadowColor = 'rgba(31,43,39,0.25)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
  rr(cx - tw / 2, y, tw, h, h / 2);
  ctx.fillStyle = kind === 'red' ? J.jade : J.ink; ctx.fill();
  ctx.restore();
  text(label, cx, y + h / 2 + 1, size, '#fff', 'center', true, SERIF);
}
type Align = 'left' | 'center' | 'right';
function text(s: string, x: number, y: number, size: number, color: string, align: Align = 'left', bold = false, font = FONT) {
  ctx.font = (bold ? 'bold ' : '') + size + 'px ' + font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}
/** 浅底上的墨色大字（标题、数字） */
function goldText(s: string, x: number, y: number, size: number, align: Align = 'center', font = SERIF) {
  ctx.font = 'bold ' + size + 'px ' + font;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size / 6); ctx.strokeStyle = 'rgba(255,251,240,0.92)';
  ctx.strokeText(s, x, y);
  ctx.fillStyle = goldGrad(y - size / 2, y + size / 2);
  ctx.fillText(s, x, y);
}
/** 深底上的鎏金字：金属渐变 + 深色描边 + 投影 */
/** 深底上的亮字（青玉卡上的数字） */
function metalText(s: string, x: number, y: number, size: number, align: Align = 'center', font = SERIF, kind: Metal = 'gold') {
  const col: Record<Metal, string> = { gold: '#fff8e6', silver: '#ffffff', bronze: '#f6e7b8', jade: '#c9f2df', red: '#ffc2b0' };
  text(s, x, y, size, col[kind], align, true, font);
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
/** 最近一次按下的按钮（按位置认），用来做按压动画 */
let press: { x: number; y: number; t: number } | null = null;
function pressAmount(x: number, y: number) {
  if (!press || press.x !== x || press.y !== y) return 0;
  const k = (clock - press.t) / 0.22;
  return k >= 1 ? 0 : Math.sin(Math.PI * k);
}
type BtnStyle = 'gold' | 'crimson' | 'violet' | 'ghost';
/** 按钮：有厚度的漆面 + 鎏金边 + 顶部高光，按下会压下去 */
/** 按钮：圆角胶囊，有一点厚度，按下会压下去 */
function button(label: string, x: number, y: number, w: number, h: number, onTap: () => void, style: BtnStyle = 'gold', enabled = true, size = 17, shown?: string) {
  const cols: Record<BtnStyle, [string, string, string]> = {
    gold: [J.ink, '#0c1311', J.rice],
    crimson: [J.red, '#7e2416', '#fff4e8'],
    violet: [J.jade, J.jade2, '#ffffff'],
    ghost: ['#ffffff', '#d9d2c2', J.ink],
  };
  const [face, base, fg] = enabled ? cols[style] : ['#e4e0d6', '#c9c3b6', '#9a958a'];
  const p = pressAmount(x, y);
  const depth = 5, fh = h - depth, dy = p * (depth - 1);
  const r = Math.min(fh / 2, 26);
  ctx.save();
  const sc = 1 - 0.03 * p;
  ctx.translate(x + w / 2, y + h / 2); ctx.scale(sc, sc); ctx.translate(-(x + w / 2), -(y + h / 2));
  ctx.save(); ctx.shadowColor = 'rgba(31,43,39,0.22)'; ctx.shadowBlur = 10 - p * 5; ctx.shadowOffsetY = 4 - p * 2;
  rr(x, y + depth, w, fh, r); ctx.fillStyle = base; ctx.fill();
  ctx.restore();
  rr(x, y + dy, w, fh, r); ctx.fillStyle = face; ctx.fill();
  if (style === 'ghost' && enabled) { ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(31,43,39,0.08)'; ctx.stroke(); }
  text(shown || label, x + w / 2, y + dy + fh / 2 + 1, size, fg, 'center', true, FONT);
  ctx.restore();
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
  ctx.beginPath(); ctx.arc(cx, cy, r + 2.5, 0, Math.PI * 2); ctx.fillStyle = ring === C.gold ? metal('gold', cx - r, cy - r, cx + r, cy + r) : ring; ctx.fill();
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
  ctx.save(); ctx.shadowColor = 'rgba(31,43,39,0.18)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
  ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.restore();
  text(muted ? '🔇' : '🔊', x, y + 1, 12, '#fff', 'center');
  hit(x - 18, y - 18, 36, 36, toggleMute);
}

// ---------- 粮草动画：数字滚动 + 收入飞向顶部 ----------
let shownCoins = -1;
let inflight = 0;
let coinPulse = -9;
interface Fly { x0: number; y0: number; v: number; t0: number; done: boolean; }
let flies: Fly[] = [];
const GRAIN = { x: PAD + 70, y: SAFE_TOP + HERO_H * 0.5 };
function tickCoins(dt: number) {
  const target = game.coins - inflight;
  if (shownCoins < 0 || game.mode === 'title') { shownCoins = game.coins; return; }
  const d = target - shownCoins;
  if (Math.abs(d) < 0.5) shownCoins = target;
  else shownCoins += d * Math.min(1, dt * 7) + Math.sign(d) * Math.min(Math.abs(d), dt * 20);
}
function drawFlies() {
  flies.forEach((f) => {
    const t = (clock - f.t0) / 0.6;
    if (t < 0) return;
    if (t >= 1) {
      if (!f.done) { f.done = true; inflight -= f.v; coinPulse = clock; }
      return;
    }
    const e = t * t;
    const cx = (f.x0 + GRAIN.x) / 2 + 40, cy = Math.min(f.y0, GRAIN.y) - 40;
    const x = (1 - e) * (1 - e) * f.x0 + 2 * (1 - e) * e * cx + e * e * GRAIN.x;
    const y = (1 - e) * (1 - e) * f.y0 + 2 * (1 - e) * e * cy + e * e * GRAIN.y;
    const r = 7 - t * 2;
    ctx.save();
    ctx.shadowColor = 'rgba(246,231,184,0.95)'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = J.rice; ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  });
  flies = flies.filter((f) => !f.done);
}
function chip(s: string, x: number, y: number, h: number, fill: string, color: string, size = 12) {
  ctx.font = 'bold ' + size + 'px ' + FONT;
  const w = ctx.measureText(s).width + h;
  rr(x, y, w, h, h / 2); ctx.fillStyle = fill; ctx.fill();
  text(s, x + w / 2, y + h / 2 + 0.5, size, color, 'center', true);
  return w;
}

/** 顶部青玉卡：粮草是整屏最大的数字，右边诸侯头像外圈是军粮进度 */
function drawHUD() {
  const x = PAD, y = SAFE_TOP, w = W - PAD * 2, h = HERO_H;
  ctx.save(); ctx.shadowColor = 'rgba(31,92,78,0.35)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
  rr(x, y, w, h, 26);
  const g = ctx.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, J.jadeHi); g.addColorStop(1, J.jade);
  ctx.fillStyle = g; ctx.fill();
  ctx.restore();
  // 一圈很淡的水纹，别让青玉卡太平
  ctx.save(); rr(x, y, w, h, 26); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 10;
  for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(x + w * 0.62, y + h * 1.25, 60 + k * 34, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
  const rent = game.rentOf(), lord = game.lord;
  const shown = Math.round(shownCoins < 0 ? game.coins : shownCoins);
  const ok = shown >= rent;
  text('粮草 · 第' + game.week + '周' + (game.endless ? ' · 无尽' : ''), x + 20, y + 20, 13, 'rgba(255,255,255,0.8)', 'left', true);
  const pk = Math.max(0, 1 - (clock - coinPulse) / 0.3);
  const big = (h > 110 ? 56 : 46) * (1 + pk * 0.06);
  const ny = y + h * 0.5 + 2;
  ctx.save(); if (pk > 0) { ctx.shadowColor = 'rgba(246,231,184,' + pk + ')'; ctx.shadowBlur = 16; }
  text(String(shown), x + 18, ny, big, '#ffffff', 'left', true, SERIF);
  ctx.restore();
  ctx.font = 'bold ' + big + 'px ' + SERIF;
  const nw = ctx.measureText(String(shown)).width;
  GRAIN.x = x + 18 + nw / 2; GRAIN.y = ny;
  text('/ ' + rent, x + 24 + nw, ny + big * 0.18, 17, 'rgba(255,255,255,0.72)', 'left', true);
  // 下方两枚小胶囊
  const cy = y + h - 30;
  let cx = x + 18;
  cx += chip('今晚 +' + game.previewIncome(), cx, cy, 22, 'rgba(255,255,255,0.16)', '#ffffff') + 8;
  chip(ok ? '够交了' : '还差 ' + (rent - shown), cx, cy, 22, ok ? J.rice : 'rgba(255,255,255,0.16)', ok ? J.jade2 : '#ffffff');
  // 右：进度环 + 诸侯头像
  const R = h * 0.36, rx = x + w - 18 - R, ry = y + h * 0.45;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(rx, ry, R, 0, Math.PI * 2); ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.stroke();
  const f = Math.max(0.02, Math.min(1, shown / Math.max(1, rent)));
  ctx.beginPath(); ctx.arc(rx, ry, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); ctx.strokeStyle = J.rice; ctx.stroke();
  ctx.lineCap = 'butt';
  avatar(lord.art, lord.icon, rx, ry, R - 11, J.rice);
  const day = Math.min(game.day, DAYS_PER_WEEK);
  const left = DAYS_PER_WEEK - day + 1;
  const tag = lord.name + ' · ' + (left <= 1 ? '今晚收粮' : left + '天后');
  ctx.font = 'bold 11px ' + FONT;
  const tw = ctx.measureText(tag).width + 16;
  rr(rx - tw / 2, ry + R - 6, tw, 20, 10); ctx.fillStyle = ok ? J.jade2 : J.red; ctx.fill();
  text(tag, rx, ry + R + 4.5, 11, '#fff', 'center', true);
  drawDays();
}
/** 七日胶囊：过去的淡青、今天墨色、未来白色 */
function drawDays() {
  const y = SAFE_TOP + HERO_H + 8, gap = 6;
  const w = (W - PAD * 2 - 36 - gap * 7) / 7;
  const day = Math.min(game.day, DAYS_PER_WEEK);
  ['一', '二', '三', '四', '五', '六', '七'].forEach((s, k) => {
    const d = k + 1, x = PAD + k * (w + gap);
    rr(x, y, w, DAYS_H, DAYS_H / 2);
    ctx.fillStyle = d < day ? J.mist : d === day ? J.ink : 'rgba(255,255,255,0.82)'; ctx.fill();
    text(s, x + w / 2, y + DAYS_H / 2 + 0.5, 12, d < day ? J.jade2 : d === day ? '#fff' : '#8b9792', 'center', true);
  });
  muteButton(W - PAD - 14, y + DAYS_H / 2);
}

function drawBoard() {
  const fx = BOARD_X - BOARD_PAD, fy = BOARD_Y - BOARD_PAD, fw = CELL * COLS + BOARD_PAD * 2, fh = CELL * ROWS + BOARD_PAD * 2;
  // 奶白圆角棋盘卡，底部一行家族图例
  panel(fx, fy, fw, fh + LEGEND_H, { r: 22, fill: 'rgba(255,250,240,0.94)' });
  {
    let lx = fx + 12; const ly = fy + fh + LEGEND_H / 2 - 4;
    (Object.keys(FAMILIES) as (keyof typeof FAMILIES)[]).forEach((k) => {
      rr(lx, ly - 5, 10, 10, 3); ctx.fillStyle = FAMILIES[k].color; ctx.fill();
      text(FAMILIES[k].name, lx + 14, ly + 0.5, 12, J.inkSoft, 'left', true);
      lx += 52;
    });
    text('同色相邻 +1', fx + fw - 12, ly + 0.5, 12, J.inkSoft, 'right');
  }
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
    const g = 3, r = 14;
    const tw = CELL - g * 2, tf = CELL - g * 2 - 3;
    const wild = cell.terrain === 'wild';
    const famCol = cell.c ? FAMILIES[CREATURES[cell.c.type].fam].color : '';
    if (wild) {
      rr(x + g, y + g, tw, tf, r); ctx.fillStyle = '#efe8d6'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#e2d8c0'; ctx.stroke();
      if (!cell.c) text('+', x + CELL / 2, y + g + tf / 2, 20, '#cdbf9f', 'center');
    } else {
      rr(x + g, y + g + 3, tw, tf, r); ctx.fillStyle = 'rgba(31,43,39,0.18)'; ctx.fill();
      ctx.save(); rr(x + g, y + g, tw, tf, r); ctx.clip();
      if (tile) ctx.drawImage(tile, x + g, y + g, tw, tf);
      else { ctx.fillStyle = t.color; ctx.fillRect(x, y, CELL, CELL); }
      const sh = ctx.createLinearGradient(0, y + g, 0, y + g + tf);
      sh.addColorStop(0, 'rgba(255,255,255,0.12)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.12)');
      ctx.fillStyle = sh; ctx.fillRect(x, y, CELL, CELL);
      ctx.restore();
    }
    // 有动物：按家族色描一圈
    if (cell.c && !hops[cell.c.id]) {
      rr(x + g + 1.5, y + g + 1.5, tw - 3, tf - 3, r - 1.5); ctx.lineWidth = 3; ctx.strokeStyle = famCol; ctx.stroke();
    }
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
      ctx.save(); ctx.translate(ox, oy - lift);
      if (cell.c.bonus > 0) {
        chip('+' + cell.c.bonus, x + 6, y + 6, 17, J.rice, '#7a5a12', 10.5);
      }
      if (cell.c.last !== null) {
        const s = String(cell.c.last);
        ctx.font = 'bold 13px ' + FONT;
        const bw = Math.max(24, ctx.measureText(s).width + 12), bh = 20;
        const bx = x + CELL - bw - 6, by = y + CELL - bh - 8;
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.22)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
        rr(bx, by, bw, bh, bh / 2); ctx.fillStyle = '#ffffff'; ctx.fill();
        ctx.restore();
        text(s, bx + bw / 2, by + bh / 2 + 0.5, 13, J.ink, 'center', true);
      }
      ctx.restore();
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
/** 主角头像 + 对白卡 */
function drawInfo() {
  const x = PAD, y = INFO_Y, w = W - PAD * 2, h = INFO_H;
  panel(x, y, w, h, { r: 20, fill: '#ffffff' });
  const hero = img('avatar_heroine');
  const a = h - 16;
  ctx.save(); rr(x + 8, y + 8, a, a, 14); ctx.clip();
  if (hero) ctx.drawImage(hero, x + 8, y + 8, a, a); else { ctx.fillStyle = J.mist; ctx.fillRect(x + 8, y + 8, a, a); text('🌸', x + 8 + a / 2, y + h / 2, 24, '#000', 'center'); }
  ctx.restore();
  const tx = x + a + 20, tw = w - a - 32;
  ctx.font = '14px ' + FONT;
  const lines = ctx.measureText(game.info).width > tw ? 2 : 1;
  wrap(game.info, tx, y + h / 2 - (lines - 1) * 10, tw, 14, J.ink, 20, 2);
}
/** 底部一排：左边小胶囊（换卡 / 看卡 / 候选池），右边深色大胶囊「结束今天」 */
function drawBottomBar() {
  const lw = 112, y = BTN_Y, h = BTN_H;
  const play = game.mode === 'play';
  if (play && game.selected >= 0) {
    button('换一张卡', PAD, y, lw, h, () => { game.deselect(); cardModal = true; }, 'ghost', true, 15);
  } else if (play && game.choices.length && !cardModal) {
    button('查看今天的卡', PAD, y, lw, h, () => { cardModal = true; }, 'violet', true, 15, '看今天的卡');
  } else {
    const pool = game.pool;
    const p = pressAmount(PAD, y);
    panel(PAD, y + p * 3, lw, h - 5, { r: (h - 5) / 2, fill: '#ffffff' });
    const cy = y + p * 3 + (h - 5) / 2;
    if (!pool.length) text('候选池 空', PAD + lw / 2, cy, 13, '#8b9792', 'center', true);
    else {
      text('候选', PAD + 14, cy, 12, J.inkSoft, 'left', true);
      const show = Math.min(pool.length, 2);
      for (let k = 0; k < show; k++) icon(pool[k].type, CREATURES[pool[k].type].icon, PAD + 56 + k * 26, cy, 18, 28);
      if (pool.length > show) text('+' + (pool.length - show), PAD + lw - 12, cy, 11, J.red, 'right', true);
    }
    hit(PAD, y, lw, h, () => {
      game.info = pool.length ? '候选池（' + pool.length + '/' + POOL_MAX + '）：' + pool.map((c) => CREATURES[c.type].name).join('、') + '。明早会和场上动物一起随机上场。'
        : '候选池是空的。格子满了以后，新来的动物会在这里排队。';
    }, '候选池');
  }
  const ex = PAD + lw + 10, ew = W - PAD - ex;
  const ready = game.canEndDay() && clock >= waitUntil;
  const urge = ready && !game.choices.length && play;
  if (urge) {
    const a = 0.25 + 0.25 * Math.sin(clock * 3.2);
    ctx.save(); ctx.shadowColor = 'rgba(47,125,107,' + a * 2 + ')'; ctx.shadowBlur = 18; rr(ex, y, ew, h - 5, (h - 5) / 2); ctx.fillStyle = J.ink; ctx.fill(); ctx.restore();
  }
  button('🌙 结束今天', ex, y, ew, h, endDay, game.choices.length ? 'violet' : 'gold', ready, 19, '结束今天  +' + game.previewIncome());
}

/** 每天早上弹出的选卡窗：三张大卡居中，下方刷新 / 跳过 */
let cardModal = true;
let dayKey = '';
let modalAt = -9;
/** 卡框金属：动物按稀有度（铜/银/金），地形玉，道具铜 */
function cardMetal(card: Card): Metal {
  if (card.kind === 'terrain') return 'jade';
  if (card.kind === 'item') return 'bronze';
  return (['bronze', 'bronze', 'silver', 'gold'] as Metal[])[CREATURES[card.type].r];
}
function cardTint(card: Card): string {
  if (card.kind === 'creature') { const f = CREATURES[card.type].fam; return f ? FAMILIES[f].color : '#c8b48a'; }
  return card.kind === 'terrain' ? '#7cc9ab' : '#e0a95a';
}
function easeOutBack(t: number) { const c = 1.4; const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; }
function drawCardModal() {
  const n = game.choices.length;
  const since = clock - modalAt;
  dim(0.62 * Math.min(1, since / 0.2));
  hit(0, 0, W, BTN_Y - 4, () => { cardModal = false; }, '收起');
  const gap = 8;
  const cw = Math.floor((W - PAD * 2 - gap * (n - 1)) / n);
  const ch = Math.min(H * 0.52, 380);
  const cy = Math.max(SAFE_TOP + 70, (H - ch) / 2 - 30);
  const tt = Math.min(1, since / 0.3);
  ctx.save(); ctx.globalAlpha = tt;
  ribbon(W / 2, cy - 50 + (1 - tt) * -10, 168, 36, game.picksLeft > 1 ? '还能选 ' + game.picksLeft + ' 张' : '选一张卡', 19);
  ctx.restore();
  game.choices.forEach((card, k) => {
    const t = Math.max(0, Math.min(1, (since - 0.05 - k * 0.07) / 0.38));
    if (t <= 0) return;
    const e = easeOutBack(t);
    const x = PAD + k * (cw + gap), y = cy + (1 - e) * 70;
    ctx.save(); ctx.globalAlpha = Math.min(1, t * 2.2);
    drawCard(card, x, y, cw, ch);
    ctx.restore();
    hit(x, cy, cw, ch, () => pickCard(k), cardInfo(card).name);
  });
  const by = cy + ch + 16, bw = (W - PAD * 2 - 12) / 2;
  const bt = Math.min(1, Math.max(0, (since - 0.25) / 0.25));
  ctx.save(); ctx.globalAlpha = bt;
  button('🔄 刷新 🌾' + game.rerollCost, PAD, by, bw, 48, () => game.reroll(), 'violet', game.canReroll(), 15);
  button('跳过', PAD + bw + 12, by, bw, 48, () => { game.skipCards(); }, 'ghost', true, 15);
  text('动物会自动上场；地形和道具选好后再点格子', W / 2, by + 68, 12, C.lacq, 'center');
  ctx.restore();
}
/** 一张卡：金属卡框 + 漆色名牌 + 家族色画框 + 象牙说明区 */
/** 一张卡：奶白圆角卡，顶部家族色名条，稀有度用描边颜色（铜/银/金），地形青玉、道具米黄 */
function drawCard(card: Card, x: number, y: number, cw: number, ch: number) {
  const info = cardInfo(card);
  const m = cardMetal(card);
  const tint = cardTint(card);
  const rare = card.kind === 'creature' ? CREATURES[card.type].r : 0;
  const rim: Record<Metal, string> = { bronze: '#d8b48c', silver: '#b9c6cf', gold: '#e8b93c', jade: '#7cc9ab', red: J.red };
  ctx.save();
  ctx.shadowColor = rare === 3 ? 'rgba(232,185,60,0.7)' : 'rgba(31,43,39,0.25)'; ctx.shadowBlur = rare === 3 ? 22 : 14; ctx.shadowOffsetY = rare === 3 ? 0 : 6;
  rr(x, y, cw, ch, 18); ctx.fillStyle = '#fffaf0'; ctx.fill();
  ctx.restore();
  rr(x + 1.5, y + 1.5, cw - 3, ch - 3, 17); ctx.lineWidth = rare >= 2 ? 3 : 2; ctx.strokeStyle = rim[m]; ctx.stroke();
  // 名条
  ctx.save(); rr(x, y, cw, ch, 18); ctx.clip();
  ctx.fillStyle = tint; ctx.fillRect(x, y, cw, 34);
  ctx.restore();
  text(info.name, x + cw / 2, y + 18, 15, '#fff', 'center', true, SERIF);
  // 画面
  const ax = x + 8, ay = y + 42, aw = cw - 16, ah = Math.min(ch * 0.36, cw * 1.0);
  rr(ax, ay, aw, ah, 12);
  const rg = ctx.createRadialGradient(ax + aw / 2, ay + ah * 0.55, 4, ax + aw / 2, ay + ah * 0.55, aw * 0.8);
  rg.addColorStop(0, '#ffffff'); rg.addColorStop(1, tint + '40');
  ctx.fillStyle = rg; ctx.fill();
  icon(cardArtKey(card), info.icon || '⬛', ax + aw / 2, ay + ah / 2 + 2, 40, Math.min(aw - 6, ah - 6));
  // 稀有度圆点
  if (card.kind === 'creature') {
    for (let g = 0; g < 3; g++) {
      const gx = x + cw / 2 + (g - 1) * 12;
      ctx.beginPath(); ctx.arc(gx, ay + ah + 10, 3.5, 0, Math.PI * 2); ctx.fillStyle = g < rare ? rim[m] : '#e6dfcf'; ctx.fill();
    }
  }
  // 标签
  const ty = ay + ah + 28;
  ctx.font = 'bold 11px ' + FONT;
  const tw = Math.min(cw - 12, ctx.measureText(info.tag).width + 18);
  rr(x + cw / 2 - tw / 2, ty - 10, tw, 20, 10); ctx.fillStyle = tint + '26'; ctx.fill();
  text(info.tag, x + cw / 2, ty + 0.5, 11, J.ink, 'center', true);
  const ry = ty + 24;
  richWrap(info.desc, x + cw / 2, ry, cw - 18, 13, 19, Math.max(2, Math.floor((y + ch - 10 - ry) / 19) + 1));
  if (rare === 3) {
    ctx.save(); rr(x, y, cw, ch, 18); ctx.clip();
    const p = (clock % 2.6) / 1.2;
    if (p < 1) {
      const sx = x - cw + p * cw * 3;
      const sg = ctx.createLinearGradient(sx, y, sx + cw * 0.5, y + ch * 0.4);
      sg.addColorStop(0, 'rgba(255,240,200,0)'); sg.addColorStop(0.5, 'rgba(255,240,200,0.4)'); sg.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = sg; ctx.fillRect(x, y, cw, ch);
    }
    ctx.restore();
  }
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


function dim(alpha = 0.5) {
  const a = Math.min(0.85, alpha * 0.95);
  const g = ctx.createRadialGradient(W / 2, H * 0.45, W * 0.2, W / 2, H * 0.45, H * 0.75);
  g.addColorStop(0, 'rgba(48,32,22,' + a * 0.85 + ')'); g.addColorStop(1, 'rgba(22,12,8,' + Math.min(0.92, a * 1.2) + ')');
  ctx.fillStyle = g;
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
  const nm = (last ? '最终关 · ' : '') + lord.name;
  ctx.font = 'bold 17px ' + SERIF;
  const nw = Math.max(110, ctx.measureText(nm).width + 40);
  ribbon(PAD + 30 + nw / 2, boxY - 20, nw, 34, nm, 17);
  wrap('「' + lord.line + '」', PAD + 20, boxY + 36, W - PAD * 2 - 40, 15, C.cream, 22, 2);
  // 军粮对比
  const by = boxY + 86, pw = (W - PAD * 2 - 40 - 36) / 2;
  lacquer(PAD + 20, by, pw, 50, 10);
  text('第' + game.week + '周军粮', PAD + 20 + pw / 2, by + 14, 11, C.lacqMuted, 'center');
  metalText(String(rent), PAD + 20 + pw / 2, by + 34, 21, 'center', FONT, 'red');
  lacquer(W - PAD - 20 - pw, by, pw, 50, 10);
  text('你的粮草', W - PAD - 20 - pw / 2, by + 14, 11, C.lacqMuted, 'center');
  metalText(String(game.coins), W - PAD - 20 - pw / 2, by + 34, 21, 'center', FONT, ok ? 'jade' : 'red');
  metalText(ok ? '≥' : '<', W / 2, by + 25, 22, 'center', FONT, ok ? 'jade' : 'red');
  button(ok ? '交出军粮' : '交不起……', PAD + 20, boxY + boxH - 66, W - PAD * 2 - 40, 50, () => game.payRent(), ok ? 'gold' : 'ghost', true, 18);
}

/** 三选一招募伙伴：三张竖卡，上半是立绘 */
let relicAt = -1;
function drawRelic() {
  drawBackground(0.55);
  dim(0.25);
  const top = SAFE_TOP + 4;
  ribbon(W / 2, top + 2, 168, 38, '招募伙伴', 21);
  shadowText(game.lord.name + '满意地走了，有人想加入你的牧场', W / 2, top + 58, 13, C.cream, 'center');
  const gap = 8;
  const cw = Math.floor((W - PAD * 2 - gap * 2) / 3);
  const avail = H - top - 120 - SAFE_BOTTOM;
  const ch = Math.min(avail, 500);
  const cy = top + 72 + Math.max(0, (avail - ch) / 2);
  game.relicChoices.forEach((k, idx) => {
    const r = RELICS[k];
    const x = PAD + idx * (cw + gap);
    const since = clock - (relicAt < 0 ? (relicAt = clock) : relicAt);
    const t = Math.max(0, Math.min(1, (since - idx * 0.08) / 0.4));
    if (t <= 0) return;
    ctx.save(); ctx.globalAlpha = Math.min(1, t * 2); ctx.translate(0, (1 - easeOutBack(t)) * 80);
    panel(x, cy, cw, ch, { r: 18, glow: 'rgba(47,125,107,' + (0.3 + 0.15 * Math.sin(clock * 2 + idx)) + ')' });
    const ph = ch - 118;
    ctx.save(); rr(x + 4, cy + 4, cw - 8, ph, 14); ctx.clip();
    const bg = ctx.createLinearGradient(0, cy, 0, cy + ph);
    bg.addColorStop(0, '#dcebe4'); bg.addColorStop(0.7, '#eef3ec'); bg.addColorStop(1, '#fffaf0');
    ctx.fillStyle = bg; ctx.fillRect(x, cy, cw, ph + 4);
    const p = img(r.art);
    if (p) drawCover(p, x + 3, cy + 6, cw - 6, ph + 20, 0);
    else text(r.icon, x + cw / 2, cy + ph / 2, 40, '#000', 'center');
    const fade = ctx.createLinearGradient(0, cy + ph * 0.7, 0, cy + ph + 3);
    fade.addColorStop(0, 'rgba(255,250,240,0)'); fade.addColorStop(1, 'rgba(255,250,240,1)');
    ctx.fillStyle = fade; ctx.fillRect(x, cy + ph * 0.7, cw, ph * 0.3 + 4);
    ctx.restore();
    rr(x + 10, cy + ph - 12, cw - 20, 30, 15); ctx.fillStyle = J.jade; ctx.fill();
    text(r.name, x + cw / 2, cy + ph + 3.5, 16, '#fff', 'center', true, SERIF);
    text('「' + r.title + '」', x + cw / 2, cy + ph + 31, 11, J.jade2, 'center', true, SERIF);
    wrap(r.desc, x + cw / 2, cy + ph + 52, cw - 16, 11, C.cream, 15, 4, 'center');
    ctx.restore();
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
  ribbon(W / 2, py - 18, 176, 40, title, 22, win ? 'red' : 'gold');
  const sub = win ? '乱世之中，你的牧场成了世外桃源！'
    : game.endless ? '撑过了 ' + game.weeksSurvived + ' 周，真了不起！'
    : '粮草不够，牧场被' + game.lord.name + '收走了……';
  text(sub, W / 2, py + 56, 13, C.cream, 'center', false, SERIF);
  // 三格数据
  const stats: [string, string][] = [['撑过', game.weeksSurvived + '周'], ['伙伴', game.relics.length + '位'], ['总收获', String(game.total)]];
  const sw = (W - 80) / 3;
  stats.forEach(([k, v], i) => {
    const sx = 40 + i * sw;
    lacquer(sx + 3, py + 84, sw - 6, 48, 10);
    text(k, sx + sw / 2, py + 97, 10.5, C.lacqMuted, 'center');
    metalText(v, sx + sw / 2, py + 117, 17, 'center', FONT);
  });
  text('最好成绩 ' + game.best + ' 周', W / 2, py + 146, 11, C.muted, 'center');
  let sy = py + 166;
  if (game.star) {
    // 最强一只：方便截图炫耀
    const st = game.star;
    fillRR(40, sy - 6, W - 80, 40, 12, 'rgba(47,125,107,0.10)');
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
  button('再来一局', 48, by, half, 46, () => game.newGame(), win ? 'ghost' : 'gold');
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
  ctx.save(); ctx.shadowColor = 'rgba(255,250,240,0.95)'; ctx.shadowBlur = 10;
  text(GAME_TITLE, W / 2 - 12, ty, 46, J.jade2, 'center', true, SERIF);
  ctx.restore();
  // 朱红印章
  ctx.font = 'bold 46px ' + SERIF;
  const sx = W / 2 - 12 + ctx.measureText(GAME_TITLE).width / 2 + 8, sy = ty - 18;
  ctx.save(); ctx.translate(sx + 15, sy + 18); ctx.rotate(0.06);
  rr(-15, -18, 30, 36, 3); ctx.fillStyle = '#b8321f'; ctx.fill();
  rr(-12.5, -15.5, 25, 31, 2); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,236,220,0.8)'; ctx.stroke();
  text('牧', 0, -6, 12, '#fff2e6', 'center', true, SERIF); text('场', 0, 8, 12, '#fff2e6', 'center', true, SERIF);
  ctx.restore();
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
  ctx.beginPath(); ctx.arc(hx, hy, 15, 0, Math.PI * 2); ctx.fillStyle = metal('gold', hx - 15, hy - 15, hx + 15, hy + 15); ctx.fill();
  ctx.beginPath(); ctx.arc(hx, hy, 13, 0, Math.PI * 2); ctx.fillStyle = '#2e1f18'; ctx.fill();
  metalText('?', hx, hy + 1, 16, 'center', FONT);
  hit(hx - 18, hy - 18, 36, 36, () => { showHelp = !showHelp; }, '玩法');
  if (showHelp) drawHelp();
}
let showHelp = false;
function drawHelp() {
  dim(0.6);
  const w = W - 48, h = 380, x = 24, y = (H - h) / 2;
  panel(x, y, w, h, { c: 12 });
  ribbon(W / 2, y - 16, 120, 34, '玩法', 19);
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
    const m = /^\+(\d+)$/.exec(f.text);
    if (m && f.color === '#ffb300' && f.cell >= 0 && +m[1] > 0) {
      const v = +m[1];
      inflight += v;
      flies.push({ x0: p.x, y0: p.y, v, t0: clock + 0.25 + flies.length * 0.05, done: false });
    }
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
let modalShown = false;
/** 点击处的金色涟漪 */
let ripples: { x: number; y: number; t: number }[] = [];
function drawRipples() {
  ripples = ripples.filter((r) => clock - r.t < 0.4);
  ripples.forEach((r) => {
    const k = (clock - r.t) / 0.4;
    ctx.beginPath(); ctx.arc(r.x, r.y, 8 + k * 26, 0, Math.PI * 2);
    ctx.lineWidth = 2 * (1 - k); ctx.strokeStyle = 'rgba(226,188,106,' + (0.8 * (1 - k)) + ')'; ctx.stroke();
  });
}
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
    tickCoins(dt);
    if (game.mode !== 'relic') relicAt = -1;
    drawHUD();
    drawBoard();
    drawInfo();
    drawBottomBar();
    const showModal = game.mode === 'play' && cardModal && game.choices.length > 0 && game.selected < 0 && clock >= waitUntil + 0.7;
    if (showModal && !modalShown) modalAt = clock;
    modalShown = showModal;
    if (showModal) drawCardModal();
    drawFloats(dt);
    drawFlies();
    if (clock >= waitUntil) {
      if (game.mode === 'rent') drawRent();
      else if (game.mode === 'relic') drawRelic();
      else if (game.mode === 'over' || game.mode === 'win') drawEnd(game.mode === 'win');
    }
  }
  drawRipples();
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
  ripples.push({ x, y, t: clock });
  for (let k = buttons.length - 1; k >= 0; k--) {
    const b = buttons[k];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      const before = game.mode, coins = game.coins, nChoices = game.choices.length;
      const cells = game.board.map((c) => JSON.stringify(c));
      press = { x: b.x, y: b.y, t: clock };
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
