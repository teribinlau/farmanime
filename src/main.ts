// 群芳牧场 —— 微信小游戏（原生 Canvas 2D，无引擎）
// 规则在 core/，这里只负责绘制和触摸。浏览器试玩时由 web/index.html 提供一个简化版 wx。
import { COLS, ROWS, DAYS_PER_WEEK, TERRAINS, CREATURES, RELICS, ITEMS, cardInfo, Card, RelicId } from './core/Data';
import { RanchGame } from './core/RanchGame';

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
  'heroine', 'bg_title',
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
const TOP_H = 104;
const BOARD_PAD = 8;
const CELL = Math.floor(Math.min((W - PAD * 2 - BOARD_PAD * 2) / COLS, (H * 0.36) / ROWS));
const BOARD_X = Math.floor((W - CELL * COLS) / 2);
const BOARD_Y = SAFE_TOP + TOP_H + BOARD_PAD + 4;
const INFO_Y = BOARD_Y + CELL * ROWS + BOARD_PAD + 10;
const INFO_H = 62;
const BTN_H = 52;
const BTN_Y = H - SAFE_BOTTOM - BTN_H - 14;
const CARDS_Y = INFO_Y + INFO_H + 14;
const CARD_H = Math.max(110, Math.min(210, BTN_Y - 14 - CARDS_Y));

function cellCenter(i: number) {
  return { x: BOARD_X + (i % COLS) * CELL + CELL / 2, y: BOARD_Y + Math.floor(i / COLS) * CELL + CELL / 2 };
}

// ---------- 主题 ----------
const C = {
  ink: '#15132a', panel: 'rgba(20,18,40,0.80)', panel2: 'rgba(34,29,60,0.88)',
  gold: '#e8cc85', goldHi: '#fff1c4', goldLo: '#a77e3c', cream: '#f7eedb', muted: '#b9add3',
  crimson: '#c03a4c', jade: '#58c2a1', violet: '#8e7cf0',
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
  g.addColorStop(0, C.goldHi); g.addColorStop(0.5, C.gold); g.addColorStop(1, C.goldLo);
  return g;
}
/** 深色半透明面板 + 金色细边 + 四角纹饰 */
function panel(x: number, y: number, w: number, h: number, opt: { c?: number; fill?: string; corners?: boolean; glow?: string } = {}) {
  const c = opt.c === undefined ? 8 : opt.c;
  ctx.save();
  if (opt.glow) { ctx.shadowColor = opt.glow; ctx.shadowBlur = 16; }
  else { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3; }
  chamfer(x, y, w, h, c);
  if (opt.fill) ctx.fillStyle = opt.fill;
  else {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(40,34,70,0.86)'); g.addColorStop(1, 'rgba(18,16,36,0.90)');
    ctx.fillStyle = g;
  }
  ctx.fill();
  ctx.restore();
  chamfer(x + 0.5, y + 0.5, w - 1, h - 1, c);
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(232,204,133,0.75)'; ctx.stroke();
  chamfer(x + 3.5, y + 3.5, w - 7, h - 7, Math.max(0, c - 2));
  ctx.strokeStyle = 'rgba(232,204,133,0.18)'; ctx.stroke();
  if (opt.corners !== false) {
    ctx.fillStyle = C.gold;
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
  ctx.lineWidth = Math.max(2, size / 7); ctx.strokeStyle = 'rgba(40,20,10,0.85)';
  ctx.strokeText(s, x, y);
  ctx.fillStyle = goldGrad(y - size / 2, y + size / 2);
  ctx.fillText(s, x, y);
}
function shadowText(s: string, x: number, y: number, size: number, color: string, align: Align = 'left', bold = false, font = FONT) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
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
    gold: ['#f6d991', '#c99a4b', '#3b2410'],
    crimson: ['#e0626f', '#9c2638', '#fff3e3'],
    violet: ['#a998ff', '#5f4cc4', '#fff8ec'],
    ghost: ['rgba(60,52,96,0.9)', 'rgba(30,26,52,0.9)', C.cream],
  };
  const [a, b, fg] = enabled ? cols[style] : ['#77708a', '#4f4a60', '#c9c3d6'];
  const c = Math.min(12, h / 3);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
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
  ctx.lineWidth = 1.2; ctx.strokeStyle = enabled ? 'rgba(255,236,180,0.9)' : 'rgba(200,190,210,0.5)'; ctx.stroke();
  // 两侧小菱形
  if (w > 140) {
    ctx.fillStyle = enabled ? (style === 'gold' ? '#6b4518' : C.gold) : '#9a93ab';
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
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#2a2448'; ctx.fill();
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
  ctx.strokeStyle = 'rgba(232,204,133,0.8)'; ctx.lineWidth = 1;
  [[-1], [1]].forEach(([d]) => {
    ctx.beginPath(); ctx.moveTo(cx + d * gap, y); ctx.lineTo(cx + d * halfW, y); ctx.stroke();
    diamond(cx + d * (gap + 6), y, 3, C.gold);
  });
}

// ---------- 场景 ----------
let petals: { x: number; y: number; s: number; v: number; r: number }[] = [];
for (let k = 0; k < 16; k++) petals.push({ x: (k * 97) % W, y: (k * 151) % H, s: 2 + (k % 3), v: 14 + (k % 5) * 5, r: k });
function drawBackground(dark = 0.62) {
  const bg = img('bg_title');
  if (bg) drawCover(bg, 0, 0, W, H, 0.4);
  else { ctx.fillStyle = '#3a2f55'; ctx.fillRect(0, 0, W, H); }
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(16,13,34,' + (dark * 0.75) + ')');
  g.addColorStop(0.45, 'rgba(16,13,34,' + dark + ')');
  g.addColorStop(1, 'rgba(10,8,22,' + Math.min(0.95, dark + 0.25) + ')');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 飘落的花瓣（带一点光晕）
  ctx.save();
  ctx.shadowColor = 'rgba(255,180,210,0.9)'; ctx.shadowBlur = 6;
  ctx.fillStyle = 'rgba(255,190,215,0.75)';
  petals.forEach((p) => {
    const x = ((p.x + clock * p.v * 0.6) % (W + 40)) - 20;
    const y = ((p.y + clock * p.v) % (H + 40)) - 20;
    ctx.beginPath(); ctx.ellipse(x, y, p.s * 1.6, p.s, (clock * 0.8 + p.r) % Math.PI, 0, Math.PI * 2); ctx.fill();
  });
  ctx.restore();
}

function muteButton(x: number, y: number) {
  ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fillStyle = 'rgba(20,18,40,0.7)'; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(232,204,133,0.7)'; ctx.stroke();
  text(muted ? '🔇' : '🔊', x, y + 1, 13, '#fff', 'center');
  hit(x - 18, y - 18, 36, 36, toggleMute);
}

function drawHUD() {
  const y = SAFE_TOP;
  // 左：周数徽章
  panel(PAD, y, 112, 56, { c: 10 });
  goldText('第' + game.week + '周', PAD + 56, y + 21, 21);
  const day = Math.min(game.day, DAYS_PER_WEEK);
  for (let d = 1; d <= DAYS_PER_WEEK; d++) {
    const cx = PAD + 56 + (d - 4) * 12;
    diamond(cx, y + 43, d === day ? 4.5 : 3.2, d < day ? C.gold : d === day ? C.goldHi : 'rgba(232,204,133,0.28)');
  }
  if (game.endless) {
    chamfer(PAD + 70, y - 6, 48, 16, 4); ctx.fillStyle = C.crimson; ctx.fill();
    text('无尽', PAD + 94, y + 2, 10, '#fff', 'center', true);
  }
  // 右：粮草
  const cw = 132, cx0 = W - PAD - cw;
  panel(cx0, y, cw, 56, { c: 10 });
  text('🌾', cx0 + 24, y + 26, 22, '#000', 'center');
  goldText(String(game.coins), cx0 + 46, y + 23, 24, 'left', FONT);
  text('今晚 +' + game.previewIncome(), cx0 + 46, y + 44, 11, C.muted, 'left');
  // 中：静音
  muteButton(PAD + 112 + (cx0 - PAD - 112) / 2, y + 28);
  // 第二行：诸侯与军粮进度
  const ry = y + 64, rh = 34;
  panel(PAD, ry, W - PAD * 2, rh, { c: 8, corners: false });
  const rent = game.rentOf(), lord = game.lord;
  avatar(lord.art, lord.icon, PAD + 20, ry + rh / 2, 11, C.crimson);
  const left = DAYS_PER_WEEK - day + 1;
  text(lord.name + ' · 军粮', PAD + 38, ry + rh / 2, 12, C.cream, 'left', true);
  const bx = PAD + 112, bw = W - PAD * 2 - 112 - 64, bh = 10, by = ry + rh / 2 - bh / 2;
  fillRR(bx, by, bw, bh, 5, 'rgba(0,0,0,0.5)');
  const ok = game.coins >= rent;
  const f = Math.max(0.02, Math.min(1, game.coins / Math.max(1, rent)));
  const pg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  if (ok) { pg.addColorStop(0, '#3a9e82'); pg.addColorStop(1, '#7fe3c1'); } else { pg.addColorStop(0, '#8e2a3a'); pg.addColorStop(1, '#e0707e'); }
  fillRR(bx, by, bw * f, bh, 5, pg as any);
  text(game.coins + ' / ' + rent, bx + bw / 2, by + bh / 2 + 0.5, 9, '#fff', 'center', true);
  text('还剩' + left + '天', W - PAD - 10, ry + rh / 2, 12, ok ? C.jade : '#ff8f9c', 'right', true);
}

function drawBoard() {
  const fx = BOARD_X - BOARD_PAD, fy = BOARD_Y - BOARD_PAD, fw = CELL * COLS + BOARD_PAD * 2, fh = CELL * ROWS + BOARD_PAD * 2;
  panel(fx, fy, fw, fh, { c: 12, fill: 'rgba(30,24,44,0.88)' });
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
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke();
    if (sel && game.canPlace(sel, cell)) {
      ctx.save();
      ctx.shadowColor = 'rgba(255,220,140,' + pulse + ')'; ctx.shadowBlur = 10;
      rr(x + g + 1, y + g + 1, CELL - g * 2 - 2, CELL - g * 2 - 2, r);
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,226,150,' + (0.5 + pulse * 0.5) + ')'; ctx.stroke();
      ctx.restore();
    }
    if (cell.c) {
      // 地面阴影
      ctx.beginPath(); ctx.ellipse(x + CELL / 2, y + CELL * 0.84, CELL * 0.28, CELL * 0.07, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fill();
      const pt = clock - (popAt[i] || -9);
      const k = pt < 0.35 ? popScale(pt / 0.35) : 1;
      const bob = Math.sin(clock * 2 + i) * 0.8;
      icon(cell.c.type, CREATURES[cell.c.type].icon, x + CELL / 2, y + CELL / 2 + bob + (1 - k) * 6, Math.floor(CELL * 0.5 * k), CELL * 0.84 * k);
      if (cell.c.bonus > 0) {
        diamond(x + 11, y + 11, 8, C.violet);
        text('+' + cell.c.bonus, x + 11, y + 11.5, 8, '#fff', 'center', true);
      }
      if (cell.c.last !== null) {
        const s = String(cell.c.last);
        ctx.font = 'bold 10px ' + FONT;
        const bw = Math.max(20, ctx.measureText(s).width + 10);
        chamfer(x + CELL - bw - 3, y + CELL - 17, bw, 14, 4);
        ctx.fillStyle = 'rgba(20,16,36,0.85)'; ctx.fill();
        ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(232,204,133,0.8)'; ctx.stroke();
        text(s, x + CELL - 3 - bw / 2, y + CELL - 9.5, 10, C.goldHi, 'center', true);
      }
    }
    hit(x, y, CELL, CELL, () => game.tapCell(i));
  });
}

/** 新放下的动物弹一下：0→1 时略微超出再回落 */
function popScale(t: number) { const c = 1.7; const u = t - 1; return Math.max(0.05, 1 + (c + 1) * u * u * u + c * u * u); }

/** 主角头像 + 对话框，显示提示 */
function drawInfo() {
  const x = PAD, y = INFO_Y, w = W - PAD * 2, h = INFO_H;
  panel(x + 26, y, w - 26, h, { c: 8, corners: false });
  const hero = img('avatar_heroine') || null;
  const ar = 27;
  ctx.beginPath(); ctx.arc(x + ar + 2, y + h / 2, ar + 2.5, 0, Math.PI * 2); ctx.fillStyle = C.gold; ctx.fill();
  ctx.beginPath(); ctx.arc(x + ar + 2, y + h / 2, ar, 0, Math.PI * 2); ctx.fillStyle = '#3a2f58'; ctx.fill();
  if (hero) {
    ctx.save(); ctx.beginPath(); ctx.arc(x + ar + 2, y + h / 2, ar, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(hero, x + 2, y + h / 2 - ar, ar * 2, ar * 2); ctx.restore();
  } else text('🌸', x + ar + 2, y + h / 2, 24, '#000', 'center');
  ctx.font = '13.5px ' + FONT;
  const lines = ctx.measureText(game.info).width > w - ar * 2 - 26 ? 2 : 1;
  wrap(game.info, x + ar * 2 + 14, y + h / 2 - (lines - 1) * 10, w - ar * 2 - 26, 13.5, C.cream, 20, 2);
}

function drawCards() {
  const n = game.choices.length;
  if (!n) {
    if (game.mode === 'play') {
      ornamentLine(W / 2, CARDS_Y + CARD_H / 2 - 16, W * 0.32, 0);
      shadowText('今天的卡已经选好了', W / 2, CARDS_Y + CARD_H / 2 + 4, 15, C.cream, 'center', true, SERIF);
      text('点「结束今天」收获粮草', W / 2, CARDS_Y + CARD_H / 2 + 28, 12, C.muted, 'center');
    }
    return;
  }
  const gap = 8, rerollW = 50;
  const cw = Math.floor((W - PAD * 2 - gap * n - rerollW) / n);
  game.choices.forEach((card, k) => {
    const picked = game.selected === k;
    const x = PAD + k * (cw + gap), y = CARDS_Y - (picked ? 10 : 0);
    const info = cardInfo(card);
    const col = cardColor(card);
    panel(x, y, cw, CARD_H, { c: 8, corners: false, glow: picked ? 'rgba(255,220,140,0.95)' : undefined, fill: 'rgba(24,20,44,0.92)' });
    // 画面区：放射光晕
    const ah = Math.max(CARD_H * 0.45, Math.min(CARD_H - 80, cw * 1.15));
    ctx.save(); chamfer(x + 4, y + 4, cw - 8, ah, 6); ctx.clip();
    const rg = ctx.createRadialGradient(x + cw / 2, y + 4 + ah * 0.55, 4, x + cw / 2, y + 4 + ah * 0.55, cw * 0.75);
    rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(20,16,36,1)');
    ctx.globalAlpha = 0.55; ctx.fillStyle = rg; ctx.fillRect(x, y, cw, ah + 8); ctx.globalAlpha = 1;
    icon(cardArtKey(card), info.icon || '⬛', x + cw / 2, y + 4 + ah / 2 + 2, 30, Math.min(cw - 8, ah - 6));
    ctx.restore();
    // 稀有度色条与标签
    ctx.fillStyle = col; ctx.fillRect(x + 4, y + 4 + ah, cw - 8, 2);
    chamfer(x + 4, y + 4, 34, 15, 4); ctx.fillStyle = 'rgba(10,8,20,0.75)'; ctx.fill();
    text(info.tag, x + 21, y + 12, 9, col, 'center', true);
    const ny = y + 4 + ah + 16;
    text(info.name, x + cw / 2, ny, 14, picked ? C.goldHi : C.cream, 'center', true, SERIF);
    wrap(info.desc, x + cw / 2, ny + 19, cw - 12, 10.5, C.muted, 14, Math.max(1, Math.floor((CARD_H - (ny - y) - 22) / 14)), 'center');
    if (picked && card.kind === 'item' && ITEMS[card.type].target === 'none') {
      chamfer(x + 8, y + CARD_H - 22, cw - 16, 16, 4); ctx.fillStyle = C.gold; ctx.fill();
      text('再点一次使用', x + cw / 2, y + CARD_H - 14, 10, '#3b2410', 'center', true);
    }
    hit(x, y, cw, CARD_H, () => game.tapCard(k));
  });
  const rx = W - PAD - rerollW;
  const can = game.canReroll();
  panel(rx, CARDS_Y, rerollW, CARD_H, { c: 8, corners: false, fill: can ? 'rgba(52,44,92,0.92)' : 'rgba(30,28,40,0.85)' });
  const cy = CARDS_Y + CARD_H / 2;
  text('🔄', rx + rerollW / 2, cy - 22, 20, '#000', 'center');
  text('刷', rx + rerollW / 2, cy + 4, 13, can ? C.cream : '#777', 'center', true, SERIF);
  text('新', rx + rerollW / 2, cy + 20, 13, can ? C.cream : '#777', 'center', true, SERIF);
  text('🌾' + game.rerollCost, rx + rerollW / 2, cy + 42, 10, can ? C.gold : '#777', 'center', true);
  if (can) hit(rx, CARDS_Y, rerollW, CARD_H, () => game.reroll(), '刷新');
}

function dim(alpha = 0.5) {
  ctx.fillStyle = 'rgba(8,6,18,' + alpha + ')';
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
  ctx.save(); text(String(game.coins), W - PAD - 20, by + 22, 22, ok ? '#86ecc8' : '#ff8f9c', 'right', true); ctx.restore();
  button(ok ? '交出军粮' : '交不起……', PAD + 20, boxY + boxH - 66, W - PAD * 2 - 40, 50, () => game.payRent(), ok ? 'gold' : 'ghost', true, 18);
}

/** 三选一招募伙伴：三张竖卡，上半是立绘 */
function drawRelic() {
  drawBackground(0.88);
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
    panel(x, cy, cw, ch, { c: 10, corners: false, fill: 'rgba(24,20,44,0.95)' });
    const ph = ch - 118;
    ctx.save(); chamfer(x + 3, cy + 3, cw - 6, ph, 8); ctx.clip();
    const bg = ctx.createLinearGradient(0, cy, 0, cy + ph);
    bg.addColorStop(0, '#3b2f66'); bg.addColorStop(0.7, '#6a3f6e'); bg.addColorStop(1, '#2a2040');
    ctx.fillStyle = bg; ctx.fillRect(x, cy, cw, ph + 4);
    const p = img(r.art);
    if (p) drawCover(p, x + 3, cy + 6, cw - 6, ph + 20, 0);
    else text(r.icon, x + cw / 2, cy + ph / 2, 40, '#000', 'center');
    const fade = ctx.createLinearGradient(0, cy + ph * 0.7, 0, cy + ph + 3);
    fade.addColorStop(0, 'rgba(24,20,44,0)'); fade.addColorStop(1, 'rgba(24,20,44,1)');
    ctx.fillStyle = fade; ctx.fillRect(x, cy + ph * 0.7, cw, ph * 0.3 + 4);
    ctx.restore();
    goldText(r.name, x + cw / 2, cy + ph + 2, 19);
    text('「' + r.title + '」', x + cw / 2, cy + ph + 26, 11, '#d6a8ff', 'center', false, SERIF);
    wrap(r.desc, x + cw / 2, cy + ph + 48, cw - 14, 11, C.muted, 15, 4, 'center');
    hit(x, cy, cw, ch, () => game.chooseRelic(k));
  });
  shadowText('点卡片招募', W / 2, cy + ch + 24, 13, C.gold, 'center', true, SERIF);
}

function drawEnd(win: boolean) {
  dim(0.75);
  const ph = win ? 330 : 280;
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
  let ax = W / 2 - (game.relics.length - 1) * 13;
  game.relics.forEach((id) => { avatar(RELICS[id].art, RELICS[id].icon, ax, py + 166, 10); ax += 26; });
  const bw = W - 96;
  let by = py + 190;
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
  drawBackground(0.12);
  // 底部渐暗，托住标题和按钮
  const fade = ctx.createLinearGradient(0, H * 0.42, 0, H);
  fade.addColorStop(0, 'rgba(14,11,30,0)'); fade.addColorStop(0.45, 'rgba(14,11,30,0.78)'); fade.addColorStop(1, 'rgba(10,8,22,0.95)');
  ctx.fillStyle = fade; ctx.fillRect(0, 0, W, H);
  const hero = img('heroine');
  const ph = H * 0.56;
  if (hero) {
    ctx.save(); ctx.shadowColor = 'rgba(255,200,220,0.5)'; ctx.shadowBlur = 24;
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
  ctx.beginPath(); ctx.arc(hx, hy, 14, 0, Math.PI * 2); ctx.fillStyle = 'rgba(20,18,40,0.7)'; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(232,204,133,0.7)'; ctx.stroke();
  text('?', hx, hy + 1, 15, C.gold, 'center', true);
  hit(hx - 18, hy - 18, 36, 36, () => { showHelp = !showHelp; }, '玩法');
  if (showHelp) drawHelp();
}
let showHelp = false;
function drawHelp() {
  dim(0.6);
  const w = W - 48, h = 250, x = 24, y = (H - h) / 2;
  panel(x, y, w, h, { c: 12 });
  goldText('玩法', W / 2, y + 30, 22);
  ornamentLine(W / 2, y + 30, w * 0.4, 44);
  [
    '每天从卡牌里选一张：动物、地形或道具',
    '动物看地形和周围邻居产出粮草',
    '每 7 天有诸侯来收军粮，交不起牧场就没了',
    '交完军粮招一位伙伴，撑过 8 周即通关',
  ].forEach((l, k) => {
    diamond(x + 24, y + 70 + k * 34, 3.5, C.gold);
    wrap(l, x + 36, y + 70 + k * 34, w - 52, 13, C.cream, 18, 2);
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
    drawHUD();
    drawBoard();
    drawInfo();
    drawCards();
    button('🌙 结束今天', PAD, BTN_Y, W - PAD * 2, BTN_H, endDay, game.choices.length ? 'violet' : 'gold', game.canEndDay() && clock >= waitUntil, 18);
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
  if (game.endDay()) waitUntil = clock + 0.9;
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
  game.board.forEach((c, i) => {
    if (JSON.stringify(c) === cells[i]) return;
    changed = true;
    const old = cells[i] ? JSON.parse(cells[i]) : null;
    if (c.c && (!old || !old.c || old.c.id !== c.c.id)) popAt[i] = clock;
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
      const before = game.mode, coins = game.coins;
      const cells = game.board.map((c) => JSON.stringify(c));
      b.onTap();
      feedback(before, coins, cells);
      if ((game.mode === 'over' || game.mode === 'win') && before !== game.mode) {
        try { wx.setStorageSync(STORAGE_KEY, game.best); } catch (e) { /* ignore */ }
      }
      saveRun();
      return;
    }
  }
  if (game.mode === 'play' && game.selected >= 0) game.deselect();
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
