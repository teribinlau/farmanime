// 群芳牧场：核心规则（纯逻辑，不依赖 Cocos，可在 Node 里单独测试）
import {
  COLS, ROWS, DAYS_PER_WEEK, RENT, TERRAINS, TERRAIN_CARDS, CREATURES, ITEMS, RELICS, LORDS, PREDATORS,
  Card, Cell, Creature, CreatureId, RelicId, ItemId, cardInfo,
} from './Data';

export type Mode = 'title' | 'play' | 'rent' | 'relic' | 'over' | 'win';

/** 给界面层播放的飘字效果 */
export interface Fx { cell: number; text: string; color: string; }

export class RanchGame {
  mode: Mode = 'title';
  week = 1;
  day = 1;
  coins = 5;
  total = 0;
  board: Cell[] = [];
  relics: RelicId[] = [];
  choices: Card[] = [];
  selected = -1;
  picksLeft = 1;
  rerollCost = 1;
  relicChoices: RelicId[] = [];
  info = '';
  best = 0;
  /** 通关后继续挑战（无尽模式） */
  endless = false;
  fx: Fx[] = [];
  /** 等待第二次点击确认替换的格子 */
  pendingReplace = -1;
  private nextId = 1;

  constructor(private rng: () => number = Math.random) {}

  // ---------- 工具 ----------
  private rand(n: number) { return Math.floor(this.rng() * n); }
  private pick<T>(a: T[]): T { return a[this.rand(a.length)]; }
  private weighted<T>(list: { v: T; w: number }[]): T {
    let sum = 0;
    list.forEach((x) => (sum += x.w));
    let r = this.rng() * sum;
    for (const x of list) { if ((r -= x.w) <= 0) return x.v; }
    return list[list.length - 1].v;
  }

  has(r: RelicId) { return this.relics.indexOf(r) >= 0; }
  /** 某周的基础军粮：前8周查表，无尽模式每周×1.3 */
  static baseRent(week: number) {
    if (week <= RENT.length) return RENT[week - 1];
    return Math.round(RENT[RENT.length - 1] * Math.pow(1.3, week - RENT.length) / 10) * 10;
  }
  rentOf(week = this.week) { return Math.round(RanchGame.baseRent(week) * (this.has('favor') ? 0.85 : 1)); }
  get weeks() { return RENT.length; }
  /** 本周来收军粮的诸侯 */
  get lord() { return LORDS[(this.week - 1) % LORDS.length]; }

  neighbors(i: number): number[] {
    const x = i % COLS, y = Math.floor(i / COLS), r: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) r.push(ny * COLS + nx);
    }
    return r;
  }
  countAround(i: number, fn: (n: Cell) => boolean) { return this.neighbors(i).filter((n) => fn(this.board[n])).length; }

  private makeCreature(type: CreatureId): Creature { return { type, bonus: 0, age: 0, id: this.nextId++, last: null }; }

  // ---------- 开局 ----------
  newGame() {
    this.week = 1; this.day = 1; this.coins = 5; this.total = 0;
    this.relics = []; this.relicChoices = []; this.fx = []; this.endless = false;
    this.board = [];
    for (let i = 0; i < COLS * ROWS; i++) this.board.push({ terrain: 'wild', c: null });
    [6, 7, 8, 11, 12, 13].forEach((i) => (this.board[i].terrain = 'grass'));
    this.board[9].terrain = 'pond';
    this.board[7].c = this.makeCreature('sheep');
    this.board[12].c = this.makeCreature('chick');
    this.info = '点一张卡，再点牧场格子来放置。';
    this.startDay();
    this.mode = 'play';
  }

  private drawCard(): Card {
    const kind = this.weighted<'creature' | 'terrain' | 'item'>([
      { v: 'creature', w: 55 }, { v: 'terrain', w: 25 }, { v: 'item', w: 20 },
    ]);
    if (kind === 'terrain') return { kind, type: this.pick(TERRAIN_CARDS) };
    if (kind === 'item') return { kind, type: this.pick(Object.keys(ITEMS) as ItemId[]) };
    const wk = this.week;
    const r = this.weighted([{ v: 1, w: 6 }, { v: 2, w: 2 + wk * 0.6 }, { v: 3, w: wk * 0.5 }]);
    const pool = (Object.keys(CREATURES) as CreatureId[]).filter((k) => CREATURES[k].r === r);
    return { kind, type: this.pick(pool) };
  }

  private startDay() {
    const n = 3 + (this.has('extra_card') ? 1 : 0);
    this.choices = [];
    for (let k = 0; k < n; k++) this.choices.push(this.drawCard());
    this.selected = -1;
    this.picksLeft = this.has('diligent') ? 2 : 1;
    this.rerollCost = 1;
  }

  // ---------- 选卡与放置 ----------
  /** replace=true 时，动物卡也可以放在已有动物的格子上（替换掉原来的） */
  canPlace(card: Card, cell: Cell, replace = false): boolean {
    if (card.kind === 'creature') return !cell.c || (replace && cell.c.type !== card.type);
    if (card.kind === 'terrain') return cell.terrain !== card.type;
    const t = ITEMS[card.type].target;
    if (t === 'creature') return !!cell.c;
    return t === 'plot';
  }

  get selectedCard(): Card | null { return this.selected >= 0 ? this.choices[this.selected] : null; }

  tapCard(k: number) {
    if (this.mode !== 'play') return;
    const card = this.choices[k];
    if (!card) return;
    if (this.selected === k && card.kind === 'item' && ITEMS[card.type].target === 'none') {
      if (card.type === 'bell') { this.addCoins(8); this.info = '叮铃～ +8粮草'; }
      this.consumeCard();
      return;
    }
    this.selected = this.selected === k ? -1 : k;
    this.pendingReplace = -1;
    if (this.selected >= 0) {
      const info = cardInfo(card);
      const noTarget = card.kind === 'item' && ITEMS[card.type].target === 'none';
      this.info = info.name + '：' + info.desc + (noTarget ? '' : '。点亮起的格子放置。');
    }
  }

  tapCell(i: number) {
    if (this.mode !== 'play') return;
    const cell = this.board[i];
    const sel = this.selectedCard;
    if (sel) {
      if (sel.kind === 'creature' && cell.c && this.canPlace(sel, cell, true)) {
        // 格子满了也能放：第一次点提示，第二次确认替换
        const old = CREATURES[cell.c.type].name;
        if (this.pendingReplace !== i) {
          this.pendingReplace = i;
          this.info = '再点一次，让' + old + '离开牧场（返还' + this.refundOf(cell) + '粮草），换成' + CREATURES[sel.type].name + '。';
          return;
        }
        this.pendingReplace = -1;
        const refund = this.refundOf(cell);
        cell.c = null;
        this.addCoins(refund, i);
        this.applyCard(sel, i);
        this.info = old + '离开了牧场（+' + refund + '），' + this.info;
        return;
      }
      this.pendingReplace = -1;
      if (this.canPlace(sel, cell)) this.applyCard(sel, i);
      else this.info = '这里不能放这张卡。';
      return;
    }
    if (cell.c) {
      const d = CREATURES[cell.c.type];
      this.info = d.name + '（' + TERRAINS[cell.terrain].name + '）：' + d.desc
        + (cell.c.bonus ? '。额外+' + cell.c.bonus : '')
        + (cell.c.last !== null ? '。昨晚产出' + cell.c.last : '');
    } else {
      this.info = TERRAINS[cell.terrain].name + '：空地，可以放动物。';
    }
  }

  deselect() { this.selected = -1; this.pendingReplace = -1; }

  /** 被替换的动物离开时返还的粮草 */
  refundOf(cell: Cell) { return cell.c ? 2 + Math.floor(cell.c.bonus / 2) : 0; }

  /** 某格动物有没有被牧羊犬守护（周围有狗就不会被吃） */
  guarded(i: number) { return this.countAround(i, (n) => !!n.c && n.c.type === 'dog') > 0; }

  tapRelicIcon(r: RelicId) { this.info = '伙伴 ' + RELICS[r].name + '「' + RELICS[r].title + '」：' + RELICS[r].desc; }

  private consumeCard() {
    this.choices.splice(this.selected, 1);
    this.selected = -1;
    this.picksLeft--;
    if (this.picksLeft <= 0) this.choices = [];
  }

  private applyCard(card: Card, idx: number) {
    const cell = this.board[idx];
    if (card.kind === 'creature') {
      cell.c = this.makeCreature(card.type);
      this.info = CREATURES[card.type].name + ' 搬进了牧场！';
    } else if (card.kind === 'terrain') {
      cell.terrain = card.type;
      this.info = '这块地变成了' + TERRAINS[card.type].name + '。';
    } else {
      switch (card.type) {
        case 'cookie': cell.c!.bonus += 2; this.info = CREATURES[cell.c!.type].name + ' 吃了饼干，永久+2！'; break;
        case 'seed': cell.terrain = 'flower'; this.info = '花田开满了彩虹色的花。'; break;
        case 'water': cell.terrain = 'pond'; this.info = '这里变成了一汪水塘。'; break;
        case 'broom':
          this.info = CREATURES[cell.c!.type].name + ' 离开了牧场，+4粮草';
          cell.c = null;
          this.addCoins(4, idx);
          break;
      }
    }
    this.consumeCard();
  }

  private addCoins(n: number, cell = -1) {
    this.coins += n;
    if (n > 0) this.total += n;
    this.fx.push({ cell, text: (n >= 0 ? '+' : '') + n, color: '#ffb300' });
  }

  /** 今天不选卡了 */
  skipCards() {
    if (this.mode !== 'play' || !this.choices.length) return;
    this.choices = []; this.selected = -1; this.pendingReplace = -1;
    this.info = '今天不选卡了，点「结束今天」收获粮草。';
  }

  canReroll() { return this.mode === 'play' && this.choices.length > 0 && this.coins >= this.rerollCost; }
  reroll() {
    if (!this.canReroll()) return;
    this.coins -= this.rerollCost;
    this.rerollCost++;
    const n = this.choices.length;
    this.choices = [];
    for (let k = 0; k < n; k++) this.choices.push(this.drawCard());
    this.selected = -1;
    this.info = '换了一批新卡。';
  }

  // ---------- 产出 ----------
  creatureIncome(i: number): number {
    const cell = this.board[i];
    const c = cell.c!;
    const v = CREATURES[c.type].income({
      i, cell, c,
      has: (r) => this.has(r),
      countAround: (fn) => this.countAround(i, fn),
    }) + c.bonus + (this.has('hot_spring') && cell.terrain === 'pond' ? 2 : 0);
    return Math.max(0, v);
  }
  previewIncome(): number {
    let sum = 0;
    this.board.forEach((cell, i) => { if (cell.c) sum += this.creatureIncome(i); });
    return Math.round(sum * (this.has('harvest') ? 1.15 : 1));
  }

  canEndDay() { return this.mode === 'play' && this.day <= DAYS_PER_WEEK; }

  /** 结束今天。返回 true 表示这一周结束、该交租了 */
  endDay(): boolean {
    if (!this.canEndDay()) return false;
    let sum = 0;
    this.board.forEach((cell, i) => {
      if (!cell.c) return;
      const v = this.creatureIncome(i);
      cell.c.last = v;
      sum += v;
      this.fx.push({ cell: i, text: '+' + v, color: '#ffb300' });
    });
    sum = Math.round(sum * (this.has('harvest') ? 1.15 : 1));
    const events: string[] = [];

    // 猛兽吃邻居：狐狸吃兔和鸡，夜枭吃青蛙和鸭，小云龙每7天吃掉周围最弱的一只。牧羊犬旁边的动物不会被吃。
    if (!this.has('peace')) {
      const eaten: number[] = [];
      this.board.forEach((cell, i) => {
        if (!cell.c || eaten.indexOf(i) >= 0) return;
        const rule = PREDATORS[cell.c.type];
        if (!rule || !rule.when(cell.c)) return;
        const prey = this.neighbors(i).filter((n) => {
          const c = this.board[n].c;
          return !!c && eaten.indexOf(n) < 0 && rule.prey(c.type) && !this.guarded(n);
        });
        if (!prey.length) return;
        let n: number;
        if (rule.weakest) {
          n = prey.reduce((a, b) => (this.creatureIncome(b) < this.creatureIncome(a) ? b : a));
        } else n = this.pick(prey);
        events.push(CREATURES[cell.c.type].name + '吃掉了' + CREATURES[this.board[n].c!.type].name);
        this.board[n].c = null;
        eaten.push(n);
        cell.c.bonus += rule.gain;
        this.fx.push({ cell: n, text: '被吃了…', color: '#e5533d' });
        this.fx.push({ cell: i, text: '永久+' + rule.gain, color: '#c79bff' });
      });
    }

    // 兔子繁殖
    const babies: number[] = [];
    const chance = this.has('fertile') ? 0.8 : 0.4;
    this.board.forEach((cell, i) => {
      if (!cell.c || cell.c.type !== 'bunny') return;
      if (this.countAround(i, (n) => !!n.c && n.c.type === 'bunny') === 0) return;
      if (this.rng() > chance) return;
      const empty = this.neighbors(i).filter((n) => !this.board[n].c && babies.indexOf(n) < 0);
      if (empty.length) babies.push(this.pick(empty));
    });
    babies.forEach((n) => {
      this.board[n].c = this.makeCreature('bunny');
      this.fx.push({ cell: n, text: '新生！', color: '#ff7eb6' });
    });
    if (babies.length) events.push('出生了' + babies.length + '只小兔');

    this.board.forEach((cell) => { if (cell.c) cell.c.age++; });

    const interest = this.has('interest') ? Math.min(10, Math.floor(this.coins * 0.05)) : 0;
    this.coins += sum + interest;
    this.total += sum + interest;
    this.info = '第' + this.day + '天收入 +' + (sum + interest)
      + (interest ? '（含利息' + interest + '）' : '')
      + (events.length ? '。' + events.join('，') : '');

    this.day++;
    if (this.day > DAYS_PER_WEEK) {
      this.choices = [];
      this.selected = -1;
      this.mode = 'rent';
      return true;
    }
    this.startDay();
    return false;
  }

  // ---------- 交租与祝福 ----------
  payRent() {
    if (this.mode !== 'rent') return;
    const rent = this.rentOf();
    if (this.coins < rent) { this.finish(false); return; }
    this.coins -= rent;
    if (this.week >= RENT.length && !this.endless) { this.finish(true); return; }
    this.offerRelics();
  }

  /** 通关后继续挑战：军粮越来越多，看能撑多少周 */
  continueEndless() {
    if (this.mode !== 'win') return;
    this.endless = true;
    this.offerRelics();
  }

  private offerRelics() {
    const pool = (Object.keys(RELICS) as RelicId[]).filter((k) => !this.has(k));
    for (let i = pool.length - 1; i > 0; i--) { const j = this.rand(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    this.relicChoices = pool.slice(0, 3);
    if (!this.relicChoices.length) { this.nextWeek('伙伴们都到齐了，新的一周开始了。'); return; }
    this.mode = 'relic';
  }

  chooseRelic(k: RelicId) {
    if (this.mode !== 'relic') return;
    this.relics.push(k);
    this.nextWeek(RELICS[k].name + ' 加入了牧场！新的一周开始了。');
  }

  private nextWeek(info: string) {
    this.week++;
    this.day = 1;
    this.info = info;
    this.startDay();
    this.mode = 'play';
  }

  /** 撑过的周数 */
  get weeksSurvived() { return this.mode === 'win' ? RENT.length : this.week - 1; }

  // ---------- 存档 ----------
  /** 进行中的一局存成字符串（结束或在标题页时返回空串） */
  save(): string {
    if (this.mode === 'title' || this.mode === 'over' || this.mode === 'win') return '';
    const { mode, week, day, coins, total, board, relics, choices, selected, picksLeft, rerollCost, relicChoices, info, endless, nextId } = this;
    return JSON.stringify({ v: 1, mode, week, day, coins, total, board, relics, choices, selected, picksLeft, rerollCost, relicChoices, info, endless, nextId });
  }
  load(str: string): boolean {
    try {
      const d = JSON.parse(str);
      if (!d || d.v !== 1 || !Array.isArray(d.board) || d.board.length !== COLS * ROWS) return false;
      Object.assign(this, {
        mode: d.mode, week: d.week, day: d.day, coins: d.coins, total: d.total, board: d.board, relics: d.relics,
        choices: d.choices, selected: d.selected, picksLeft: d.picksLeft, rerollCost: d.rerollCost,
        relicChoices: d.relicChoices, info: d.info, endless: !!d.endless, nextId: d.nextId, fx: [],
      });
      return true;
    } catch (e) { return false; }
  }

  private finish(win: boolean) {
    this.mode = win ? 'win' : 'over';
    this.best = Math.max(this.best, this.weeksSurvived);
  }
}
