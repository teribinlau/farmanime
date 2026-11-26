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
function muteButton(x: number, y: number) {
  text(muted ? '🔇' : '🔊', x, y, 16, '#000', 'center');
  hit(x - 18, y - 16, 36, 32, toggleMute);
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
const HUD_H = 84;
const CELL = Math.floor(Math.min((W - PAD * 2) / COLS, (H * 0.4) / ROWS));
const BOARD_X = Math.floor((W - CELL * COLS) / 2);
const BOARD_Y = SAFE_TOP + HUD_H + 6;
const INFO_Y = BOARD_Y + CELL * ROWS + 10;
const INFO_H = 48;
const BTN_H = 48;
const BTN_Y = H - SAFE_BOTTOM - BTN_H - 12;
const CARD_H = Math.max(96, Math.min(150, BTN_Y - (INFO_Y + INFO_H + 12) - 12));
const CARDS_Y = BTN_Y - 12 - CARD_H;

function cellCenter(i: number) {
  return { x: BOARD_X + (i % COLS) * CELL + CELL / 2, y: BOARD_Y + Math.floor(i / COLS) * CELL + CELL / 2 };
}

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
function fillRR(x: number, y: number, w: number, h: number, r: number, color: string) {
  rr(x, y, w, h, r); ctx.fillStyle = color; ctx.fill();
}
type Align = 'left' | 'center' | 'right';
function text(s: string, x: number, y: number, size: number, color: string, align: Align = 'left', bold = false) {
  ctx.font = (bold ? 'bold ' : '') + size + 'px ' + FONT;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
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
function button(label: string, x: number, y: number, w: number, h: number, onTap: () => void, color = '#ff8fb1', enabled = true, size = 17) {
  fillRR(x, y, w, h, h / 2, enabled ? color : '#cfc8d6');
  text(label, x + w / 2, y + h / 2 + 1, size, '#fff', 'center', true);
  if (enabled) hit(x, y, w, h, onTap, label);
}
/** 等比画进框里；bottom=true 时脚底贴住框底（立绘用） */
function drawContain(im: any, cx: number, cy: number, bw: number, bh: number, bottom = false) {
  const s = Math.min(bw / im.width, bh / im.height);
  const w = im.width * s, h = im.height * s;
  const y = bottom ? cy + bh / 2 - h : cy - h / 2;
  ctx.drawImage(im, cx - w / 2, y, w, h);
}
/** 有图画图，没图画 emoji */
function icon(key: string, emoji: string, cx: number, cy: number, fontSize: number, box: number) {
  const im = img(key);
  if (im) drawContain(im, cx, cy, box, box);
  else if (emoji) text(emoji, cx, cy, fontSize, '#000', 'center');
}
function avatar(key: string, emoji: string, cx: number, cy: number, r: number) {
  const im = img('avatar_' + key);
  ctx.beginPath(); ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  if (!im) { text(emoji, cx, cy, r * 1.2, '#000', 'center'); return; }
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#f3ecff'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.drawImage(im, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}
function cardArtKey(card: Card) {
  return card.kind === 'creature' ? card.type : card.kind === 'terrain' ? 'tile_' + card.type : 'item_' + card.type;
}

// ---------- 场景 ----------
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#ffe9e1');
  g.addColorStop(0.5, '#fde4f2');
  g.addColorStop(1, '#f1f7e6');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 飘落的花瓣
  ctx.fillStyle = 'rgba(255,170,200,0.55)';
  for (let k = 0; k < 10; k++) {
    const x = ((k * 97 + clock * (12 + k * 2)) % (W + 40)) - 20;
    const y = ((k * 151 + clock * (18 + k * 3)) % (H + 40)) - 20;
    ctx.beginPath();
    ctx.ellipse(x, y, 4, 2.4, (clock + k) % Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHUD() {
  const y = SAFE_TOP;
  fillRR(PAD, y, W - PAD * 2, HUD_H - 6, 14, 'rgba(255,255,255,0.86)');
  const head = '第' + game.week + '周 · 第' + Math.min(game.day, DAYS_PER_WEEK) + '天' + (game.endless ? ' · 无尽' : '');
  text(head, PAD + 12, y + 17, 16, '#5a4a6b', 'left', true);
  ctx.font = 'bold 16px ' + FONT;
  muteButton(PAD + 12 + ctx.measureText(head).width + 20, y + 17);
  text('🌾 ' + game.coins, W - PAD - 12, y + 17, 18, '#d08a00', 'right', true);
  const left = DAYS_PER_WEEK - Math.min(game.day, DAYS_PER_WEEK) + 1;
  const rent = game.rentOf();
  const lord = game.lord;
  avatar(lord.art, lord.icon, PAD + 22, y + 39, 9);
  text(lord.name + '要收军粮 ' + rent + ' · 还剩' + left + '天', PAD + 36, y + 39, 13, game.coins >= rent ? '#4c9a5b' : '#d0566d');
  text('🌙 今晚预计 +' + game.previewIncome(), PAD + 12, y + 61, 12, '#b08a3a');
  let rx = W - PAD - 22;
  for (let k = game.relics.length - 1; k >= 0; k--) {
    const id = game.relics[k];
    avatar(RELICS[id].art, RELICS[id].icon, rx, y + 60, 11);
    hit(rx - 12, y + 48, 24, 24, () => game.tapRelicIcon(id));
    rx -= 26;
  }
}

function drawBoard() {
  fillRR(BOARD_X - 6, BOARD_Y - 6, CELL * COLS + 12, CELL * ROWS + 12, 16, '#c9a77c');
  const sel = game.selectedCard;
  game.board.forEach((cell, i) => {
    const x = BOARD_X + (i % COLS) * CELL, y = BOARD_Y + Math.floor(i / COLS) * CELL;
    const t = TERRAINS[cell.terrain];
    const tile = img('tile_' + cell.terrain);
    if (tile) {
      ctx.save(); rr(x + 2, y + 2, CELL - 4, CELL - 4, 10); ctx.clip();
      ctx.drawImage(tile, x + 2, y + 2, CELL - 4, CELL - 4);
      ctx.restore();
    } else {
      fillRR(x + 2, y + 2, CELL - 4, CELL - 4, 10, t.color);
      if (t.icon) text(t.icon, x + 7, y + 13, 11, '#000');
    }
    if (sel && game.canPlace(sel, cell)) {
      rr(x + 2, y + 2, CELL - 4, CELL - 4, 10);
      ctx.lineWidth = 3; ctx.strokeStyle = '#ff5f9e'; ctx.stroke();
    }
    if (cell.c) {
      const pt = clock - (popAt[i] || -9);
      const k = pt < 0.35 ? popScale(pt / 0.35) : 1;
      icon(cell.c.type, CREATURES[cell.c.type].icon, x + CELL / 2, y + CELL / 2 + 2 + (1 - k) * 6, Math.floor(CELL * 0.48 * k), CELL * 0.82 * k);
      if (cell.c.bonus > 0) text('+' + cell.c.bonus, x + 6, y + CELL - 11, 11, '#7a3cff', 'left', true);
      if (cell.c.last !== null) {
        const bw = 24;
        fillRR(x + CELL - bw - 4, y + CELL - 18, bw, 14, 7, 'rgba(255,255,255,0.85)');
        text(String(cell.c.last), x + CELL - 4 - bw / 2, y + CELL - 11, 10, '#d08a00', 'center', true);
      }
    }
    hit(x, y, CELL, CELL, () => game.tapCell(i));
  });
}

/** 新放下的动物弹一下：0→1 时略微超出再回落 */
function popScale(t: number) { const c = 1.7; const u = t - 1; return Math.max(0.05, 1 + (c + 1) * u * u * u + c * u * u); }

function drawInfo() {
  fillRR(PAD, INFO_Y, W - PAD * 2, INFO_H, 12, 'rgba(255,255,255,0.86)');
  wrap(game.info, PAD + 10, INFO_Y + 14, W - PAD * 2 - 20, 13, '#5a4a6b', 18, 2);
}

function drawCards() {
  const n = game.choices.length;
  if (!n) {
    if (game.mode === 'play') text('今天的卡已经选好了，点「结束今天」收获粮草吧', W / 2, CARDS_Y + CARD_H / 2, 13, '#8a7a9b', 'center');
    return;
  }
  const gap = 8, rerollW = 56;
  const cw = Math.floor((W - PAD * 2 - gap * n - rerollW) / n);
  game.choices.forEach((card, k) => {
    const picked = game.selected === k;
    const x = PAD + k * (cw + gap), y = CARDS_Y - (picked ? 8 : 0);
    const info = cardInfo(card);
    rr(x, y, cw, CARD_H, 12);
    ctx.fillStyle = card.kind === 'creature' ? '#fff' : card.kind === 'terrain' ? '#effbe8' : '#fff4dc';
    ctx.fill();
    ctx.lineWidth = picked ? 3 : 1.5;
    ctx.strokeStyle = picked ? '#ff5f9e' : '#e3d6ec';
    ctx.stroke();
    text(info.tag, x + 8, y + 12, 10, '#a08bb5');
    icon(cardArtKey(card), info.icon || '⬛', x + cw / 2, y + 36, 28, 44);
    text(info.name, x + cw / 2, y + 66, 14, '#5a4a6b', 'center', true);
    wrap(info.desc, x + cw / 2, y + 86, cw - 10, 10, '#8a7a9b', 13, Math.max(1, Math.floor((CARD_H - 86) / 13)), 'center');
    if (picked && card.kind === 'item' && ITEMS[card.type].target === 'none') {
      text('再点一次使用', x + cw / 2, y + CARD_H - 12, 10, '#ff5f9e', 'center', true);
    }
    hit(x, y, cw, CARD_H, () => game.tapCard(k));
  });
  const rx = W - PAD - rerollW;
  const can = game.canReroll();
  fillRR(rx, CARDS_Y, rerollW, CARD_H, 12, can ? '#e8ddff' : '#eee');
  const cy = CARDS_Y + CARD_H / 2;
  text('🔄', rx + rerollW / 2, cy - 14, 20, '#000', 'center');
  text('刷新', rx + rerollW / 2, cy + 10, 12, '#6b5a8a', 'center', true);
  text('🌾' + game.rerollCost, rx + rerollW / 2, cy + 28, 11, '#d08a00', 'center');
  if (can) hit(rx, CARDS_Y, rerollW, CARD_H, () => game.reroll());
}

function dim(alpha = 0.5) {
  ctx.fillStyle = 'rgba(60,40,80,' + alpha + ')';
  ctx.fillRect(0, 0, W, H);
  hit(0, 0, W, H, () => { /* 拦截点击 */ });
}

/** 诸侯来收军粮：立绘 + 底部对话框 */
function drawRent() {
  dim(0.55);
  const lord = game.lord;
  const rent = game.rentOf();
  const ok = game.coins >= rent;
  const boxH = 208;
  const boxY = H - SAFE_BOTTOM - boxH - 12;
  const portrait = img(lord.art);
  const ph = Math.min(H * 0.6, boxY - SAFE_TOP + 30);
  if (portrait) drawContain(portrait, W / 2, boxY + 30 - ph / 2, W, ph, true);
  else text(lord.icon, W / 2, boxY - 90, 90, '#000', 'center');
  fillRR(PAD, boxY, W - PAD * 2, boxH, 18, 'rgba(255,250,245,0.97)');
  fillRR(PAD + 14, boxY - 16, 116, 32, 16, game.week === game.weeks && !game.endless ? '#c0392b' : '#8f7cff');
  text((game.week === game.weeks && !game.endless ? '最终关 · ' : '') + lord.name, PAD + 72, boxY, 16, '#fff', 'center', true);
  wrap('「' + lord.line + '」', PAD + 18, boxY + 34, W - PAD * 2 - 36, 15, '#5a4a6b', 21, 2);
  text('第' + game.week + '周军粮：' + rent + ' 粮草', PAD + 18, boxY + 88, 14, '#5a4a6b');
  text('你现在有：' + game.coins + ' 粮草', PAD + 18, boxY + 110, 14, ok ? '#4c9a5b' : '#d0566d', 'left', true);
  button(ok ? '交出军粮' : '交不起……', PAD + 18, boxY + boxH - 64, W - PAD * 2 - 36, 48, () => game.payRent(), ok ? '#ff8fb1' : '#a58fb8');
}

/** 三选一招募伙伴：三张竖卡，上半是立绘 */
function drawRelic() {
  dim(0.85);
  const top = SAFE_TOP + 8;
  text(game.lord.name + '满意地走了', W / 2, top + 14, 20, '#fff', 'center', true);
  text('有人想加入你的牧场，选一位伙伴吧', W / 2, top + 42, 14, '#f3e8ff', 'center');
  const gap = 8;
  const cw = Math.floor((W - PAD * 2 - gap * 2) / 3);
  const ch = Math.min(H - top - 90 - SAFE_BOTTOM - 20, 380);
  const cy = top + 66;
  game.relicChoices.forEach((k, idx) => {
    const r = RELICS[k];
    const x = PAD + idx * (cw + gap);
    fillRR(x, cy, cw, ch, 14, '#fffaf5');
    const ph = ch * 0.58;
    ctx.save(); rr(x, cy, cw, ph, 14); ctx.clip();
    const bg = ctx.createLinearGradient(0, cy, 0, cy + ph);
    bg.addColorStop(0, '#f6e9ff'); bg.addColorStop(1, '#ffe4ef');
    ctx.fillStyle = bg; ctx.fillRect(x, cy, cw, ph);
    const p = img(r.art);
    if (p) drawContain(p, x + cw / 2, cy + ph / 2 + 4, cw * 1.25, ph - 4, true);
    else text(r.icon, x + cw / 2, cy + ph / 2, 40, '#000', 'center');
    ctx.restore();
    text(r.name, x + cw / 2, cy + ph + 20, 17, '#5a4a6b', 'center', true);
    text('「' + r.title + '」', x + cw / 2, cy + ph + 42, 12, '#b07ad0', 'center');
    wrap(r.desc, x + cw / 2, cy + ph + 64, cw - 14, 12, '#7a6a8b', 16, Math.max(2, Math.floor((ch - ph - 70) / 16)), 'center');
    hit(x, cy, cw, ch, () => game.chooseRelic(k));
  });
  text('点卡片招募', W / 2, cy + ch + 22, 13, '#f3e8ff', 'center');
}

function drawEnd(win: boolean) {
  dim(0.55);
  const ph = 330;
  const py = (H - ph) / 2 + 40;
  const who = win ? img('heroine') : img(game.lord.art);
  if (who) drawContain(who, W / 2, py - 90, W * 0.6, 220, true);
  fillRR(24, py, W - 48, ph - 40, 20, '#fffaf5');
  const title = win ? '乱世之中，你的牧场成了世外桃源！'
    : game.endless ? '无尽挑战结束，撑过了 ' + game.weeksSurvived + ' 周！'
    : '粮草不够，牧场被' + game.lord.name + '收走了……';
  text(title, W / 2, py + 36, 16, '#5a4a6b', 'center', true);
  text('撑过 ' + game.weeksSurvived + ' 周 · 伙伴 ' + game.relics.length + ' 位', W / 2, py + 70, 14, '#8a7a9b', 'center');
  text('累计收获 ' + game.total + ' 粮草 · 最好成绩 ' + game.best + ' 周', W / 2, py + 94, 13, '#a08bb5', 'center');
  let ax = W / 2 - (game.relics.length - 1) * 13;
  game.relics.forEach((id) => { avatar(RELICS[id].art, RELICS[id].icon, ax, py + 128, 11); ax += 26; });
  const bw = W - 108;
  let by = py + 158;
  if (win) {
    button('继续挑战（无尽模式）', 54, by, bw, 46, () => game.continueEndless(), '#8f7cff');
    by += 56;
  }
  const canShare = !!wx.shareAppMessage;
  const half = canShare ? (bw - 10) / 2 : bw;
  button('再来一局', 54, by, half, 46, () => game.newGame(), win ? '#ffb3c9' : '#ff8fb1');
  if (canShare) button('分享战绩', 54 + half + 10, by, half, 46, () => shareResult(), '#f5b544');
}

function shareResult() {
  const t = game.mode === 'win'
    ? '我在' + GAME_TITLE + '撑过了全部 8 周，牧场成了世外桃源！你也来试试？'
    : '我在' + GAME_TITLE + '撑过了 ' + game.weeksSurvived + ' 周，你能坚持多久？';
  try { wx.shareAppMessage({ title: t }); } catch (e) { /* ignore */ }
}

function drawTitle() {
  const bg = img('bg_title');
  if (bg) {
    const s = Math.max(W / bg.width, H / bg.height);
    ctx.drawImage(bg, (W - bg.width * s) / 2, (H - bg.height * s) / 2, bg.width * s, bg.height * s);
    const fade = ctx.createLinearGradient(0, H * 0.45, 0, H);
    fade.addColorStop(0, 'rgba(255,248,244,0)');
    fade.addColorStop(0.35, 'rgba(255,248,244,0.85)');
    fade.addColorStop(1, 'rgba(255,248,244,0.95)');
    ctx.fillStyle = fade; ctx.fillRect(0, 0, W, H);
  }
  const hero = img('heroine');
  const ph = H * 0.42;
  if (hero) drawContain(hero, W / 2, SAFE_TOP + ph / 2, W, ph, true);
  else text('🌸', W / 2, SAFE_TOP + ph / 2, 72, '#000', 'center');
  const ty = SAFE_TOP + ph + 36;
  text(GAME_TITLE, W / 2, ty, 36, '#6b4f8a', 'center', true);
  text('乱世之中，和三国美少女们一起经营牧场', W / 2, ty + 38, 14, '#8a7a9b', 'center');
  [
    '每天从卡牌里选一张：动物、地形或道具',
    '动物看地形和周围邻居产出粮草',
    '每7天有诸侯来收军粮，交不起牧场就没了',
    '交完军粮招一位伙伴，撑过8周即通关',
  ].forEach((l, k) => text('· ' + l, W / 2, ty + 72 + k * 24, 13, '#5a4a6b', 'center'));
  if (game.best) text('最好成绩：撑过 ' + game.best + ' 周', W / 2, ty + 172, 13, '#a08bb5', 'center');
  const run = savedRun();
  const by = Math.min(H - SAFE_BOTTOM - (run ? 128 : 70), ty + 192);
  if (run) {
    button('继续上局', W / 2 - 100, by, 200, 52, () => { if (!game.load(run)) game.newGame(); }, '#ff8fb1', true, 19);
    button('重新开始', W / 2 - 100, by + 62, 200, 44, () => game.newGame(), '#c3b2d6', true, 16);
  } else {
    button('开始经营', W / 2 - 100, by, 200, 52, () => game.newGame(), '#ff8fb1', true, 19);
  }
  muteButton(W - PAD - 18, SAFE_TOP + 10);
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
    text(f.text, f.x, f.y - f.t * 34, 16, f.color, 'center', true);
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
  drawBackground();
  if (game.mode === 'title') {
    drawTitle();
  } else {
    drawHUD();
    drawBoard();
    drawInfo();
    drawCards();
    button('🌙 结束今天', PAD, BTN_Y, W - PAD * 2, BTN_H, endDay, '#8f7cff', game.canEndDay() && clock >= waitUntil);
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
