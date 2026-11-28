// 群芳牧场：静态数据（与引擎无关）

export const COLS = 5;
export const ROWS = 4;
export const DAYS_PER_WEEK = 7;
export const RENT = [30, 95, 200, 380, 650, 1050, 1550, 2250];

export type TerrainId = 'wild' | 'grass' | 'pond' | 'flower' | 'forest' | 'cave';
export type CreatureId =
  | 'sheep' | 'duck' | 'chick' | 'bunny' | 'frog'
  | 'pig' | 'dog' | 'bee' | 'fox'
  | 'deer' | 'owl' | 'dragon';
export type ItemId = 'cookie' | 'seed' | 'water' | 'broom' | 'bell' | 'flag_tian' | 'flag_xi' | 'flag_shan' | 'flag_ling';

/** 动物家族：同家族的邻居互相 +1，家族令让整个家族永久变强 */
export type FamilyId = 'tian' | 'xi' | 'shan' | 'ling';
export const FAMILIES: Record<FamilyId, { name: string; icon: string; color: string }> = {
  tian: { name: '田园', icon: '🌾', color: '#c58b2a' },
  xi:   { name: '溪畔', icon: '🌊', color: '#3f8fb5' },
  shan: { name: '山林', icon: '🌲', color: '#4f8a3c' },
  ling: { name: '灵兽', icon: '✨', color: '#8a5aa8' },
};
export type RelicId =
  | 'full_moon' | 'hot_spring' | 'harvest' | 'extra_card' | 'interest'
  | 'peace' | 'fertile' | 'favor' | 'diligent';

export interface Creature { type: CreatureId; bonus: number; age: number; id: number; last: number | null; }
export interface Cell { terrain: TerrainId; c: Creature | null; }

export type Card =
  | { kind: 'creature'; type: CreatureId }
  | { kind: 'terrain'; type: TerrainId }
  | { kind: 'item'; type: ItemId };

/** 计算产出时可用的上下文 */
export interface IncomeCtx {
  i: number;
  cell: Cell;
  c: Creature;
  has(r: RelicId): boolean;
  countAround(fn: (n: Cell) => boolean): number;
}

export interface TerrainDef { name: string; color: string; icon: string; }
export interface CreatureDef { name: string; icon: string; r: 1 | 2 | 3; fam: FamilyId; desc: string; income(x: IncomeCtx): number; }
export interface ItemDef { name: string; icon: string; desc: string; target: 'creature' | 'plot' | 'none'; }
/** 伙伴（交完军粮后三选一加入牧场的三国美少女），art 为图片 key */
export interface RelicDef { name: string; title: string; icon: string; art: string; desc: string; }
/** 每周来收军粮的诸侯 */
export interface LordDef { name: string; art: string; icon: string; line: string; }

export const TERRAINS: Record<TerrainId, TerrainDef> = {
  wild:   { name: '荒地', color: '#e3d3ac', icon: '' },
  grass:  { name: '草地', color: '#a6e07f', icon: '🌿' },
  pond:   { name: '水塘', color: '#8fd3f5', icon: '💧' },
  flower: { name: '花田', color: '#f9c0d8', icon: '🌸' },
  forest: { name: '森林', color: '#6fbf73', icon: '🌲' },
  cave:   { name: '岩洞', color: '#b7a796', icon: '🪨' },
};
export const TERRAIN_CARDS: TerrainId[] = ['grass', 'pond', 'flower', 'forest', 'cave'];

export const CREATURES: Record<CreatureId, CreatureDef> = {
  sheep:  { name: '云朵羊', icon: '🐑', r: 1, fam: 'tian', desc: '产出2，在草地上+2',
    income: (x) => 2 + (x.cell.terrain === 'grass' ? 2 : 0) + (x.has('full_moon') ? 2 : 0) },
  duck:   { name: '胖胖鸭', icon: '🦆', r: 1, fam: 'xi', desc: '产出1，在水塘上+3',
    income: (x) => 1 + (x.cell.terrain === 'pond' ? 3 : 0) },
  chick:  { name: '布丁鸡', icon: '🐤', r: 1, fam: 'tian', desc: '产出2，每第3天下蛋+5',
    income: (x) => 2 + ((x.c.age + 1) % 3 === 0 ? 5 : 0) },
  bunny:  { name: '星星兔', icon: '🐰', r: 1, fam: 'ling', desc: '产出1，周围有兔子时夜里可能生小兔',
    income: () => 1 },
  frog:   { name: '跳跳蛙', icon: '🐸', r: 1, fam: 'xi', desc: '在水塘上产出2，周围每块水塘+1',
    income: (x) => (x.cell.terrain === 'pond' ? 2 : 0) + x.countAround((n) => n.terrain === 'pond') },
  pig:    { name: '蘑菇猪', icon: '🐷', r: 2, fam: 'shan', desc: '产出1，在森林或岩洞上+4',
    income: (x) => 1 + (x.cell.terrain === 'forest' || x.cell.terrain === 'cave' ? 4 : 0) },
  dog:    { name: '牧羊犬', icon: '🐕', r: 2, fam: 'tian', desc: '产出1，周围每只羊+2；守护周围动物不被吃',
    income: (x) => 1 + 2 * x.countAround((n) => !!n.c && n.c.type === 'sheep') },
  bee:    { name: '蜜蜂群', icon: '🐝', r: 2, fam: 'xi', desc: '自己和周围每块花田+2',
    income: (x) => 2 * ((x.cell.terrain === 'flower' ? 1 : 0) + x.countAround((n) => n.terrain === 'flower')) },
  fox:    { name: '小狐狸', icon: '🦊', r: 2, fam: 'shan', desc: '产出3，夜里吃掉周围一只兔或鸡，永久+2',
    income: (x) => 3 + (x.has('peace') ? 2 : 0) },
  deer:   { name: '月光鹿', icon: '🦌', r: 3, fam: 'shan', desc: '在森林上产出8，否则1',
    income: (x) => (x.cell.terrain === 'forest' ? 8 : 1) },
  owl:    { name: '夜枭', icon: '🦉', r: 3, fam: 'ling', desc: '产出1，周围每只动物+1；夜里吃掉周围一只青蛙或鸭，永久+3',
    income: (x) => 1 + x.countAround((n) => !!n.c) },
  dragon: { name: '小云龙', icon: '🐉', r: 3, fam: 'ling', desc: '产出1，每天永久+1；每7天吃掉周围最弱的一只动物，永久+3',
    income: (x) => 1 + x.c.age },
};

/** 会吃邻居的动物：prey 可以吃谁，when 哪天吃，gain 吃一只永久加多少，weakest 挑最弱的吃 */
export interface PredatorRule { prey(t: CreatureId): boolean; when(c: Creature): boolean; gain: number; weakest?: boolean; }
/** 吃掉别的动物时，额外永久继承它产出的一半 */
export const INHERIT = 0.5;

export const PREDATORS: Partial<Record<CreatureId, PredatorRule>> = {
  fox:    { prey: (t) => t === 'bunny' || t === 'chick', when: () => true, gain: 2 },
  owl:    { prey: (t) => t === 'frog' || t === 'duck', when: () => true, gain: 3 },
  dragon: { prey: (t) => t !== 'dragon', when: (c) => (c.age + 1) % 7 === 0, gain: 3, weakest: true },
};

export const ITEMS: Record<ItemId, ItemDef> = {
  cookie: { name: '云朵饼干', icon: '🍪', desc: '一只动物永久+2', target: 'creature' },
  seed:   { name: '彩虹种子', icon: '🌈', desc: '把一块地变成花田', target: 'plot' },
  water:  { name: '洒水壶', icon: '🚿', desc: '把一块地变成水塘', target: 'plot' },
  broom:  { name: '小扫帚', icon: '🧹', desc: '移走一只动物，返还4粮草', target: 'creature' },
  bell:   { name: '招财铃', icon: '🔔', desc: '立刻获得8粮草（再点一次使用）', target: 'none' },
  flag_tian: { name: '田园令', icon: '🌾', desc: '田园家（羊、犬、鸡）全部永久+1（再点一次使用）', target: 'none' },
  flag_xi:   { name: '溪畔令', icon: '🌊', desc: '溪畔家（鸭、蛙、蜂）全部永久+1（再点一次使用）', target: 'none' },
  flag_shan: { name: '山林令', icon: '🌲', desc: '山林家（猪、鹿、狐）全部永久+1（再点一次使用）', target: 'none' },
  flag_ling: { name: '灵兽令', icon: '✨', desc: '灵兽家（兔、枭、龙）全部永久+1（再点一次使用）', target: 'none' },
};

export const RELICS: Record<RelicId, RelicDef> = {
  full_moon:  { name: '蔡文姬', title: '胡笳十八拍', icon: '🎶', art: 'hero_caiwenji', desc: '琴声让羊群安心，所有云朵羊+2' },
  hot_spring: { name: '孙尚香', title: '弓腰姬', icon: '🏹', art: 'hero_sunshangxiang', desc: '江东水师出身，水塘上的动物+2' },
  harvest:    { name: '张飞', title: '燕人屠户', icon: '🍖', art: 'hero_zhangfei', desc: '很会做买卖，每晚总收入+15%' },
  extra_card: { name: '诸葛亮', title: '卧龙', icon: '🪶', art: 'hero_zhugeliang', desc: '神机妙算，每天多一张候选卡' },
  interest:   { name: '黄月英', title: '木牛流马', icon: '⚙️', art: 'hero_huangyueying', desc: '帮你打理粮仓，每晚获得持有粮草的5%（最多10）' },
  peace:      { name: '关羽', title: '义薄云天', icon: '⚔️', art: 'hero_guanyu', desc: '镇住了猛兽，它们不再吃邻居，狐狸产出+2' },
  fertile:    { name: '小乔', title: '花月佳人', icon: '🎀', art: 'hero_xiaoqiao', desc: '最会照顾小动物，兔子繁殖概率翻倍' },
  favor:      { name: '貂蝉', title: '闭月', icon: '🌙', art: 'hero_diaochan', desc: '诸侯们都给她面子，之后的军粮-15%' },
  diligent:   { name: '赵云', title: '白马银枪', icon: '🐎', art: 'hero_zhaoyun', desc: '一人顶两人，每天可以选2张卡' },
};

/** 第 1–8 周来收军粮的诸侯，第 8 周是最终关 */
export const LORDS: LordDef[] = [
  { name: '袁术', art: 'lord_yuanshu', icon: '🍯', line: '听说你这里有好吃的蜂蜜？……咳，先交军粮！' },
  { name: '刘表', art: 'lord_liubiao', icon: '📜', line: '荆州太平无事，交了粮就让你安心放牧。' },
  { name: '袁绍', art: 'lord_yuanshao', icon: '🏰', line: '四世三公的大军要过冬，粮草可不能少！' },
  { name: '孙权', art: 'lord_sunquan', icon: '⛵', line: '江东水军要出征了，这批粮草就算你入股。' },
  { name: '刘备', art: 'lord_liubei', icon: '🌾', line: '我实在不想为难百姓……可军中真的断粮了。' },
  { name: '曹操', art: 'lord_caocao', icon: '🍶', line: '天下英雄，唯使君与牧场主耳。粮，拿来。' },
  { name: '司马懿', art: 'lord_simayi', icon: '🦊', line: '我等这一刻，已经很久了。' },
  { name: '董卓', art: 'lord_dongzhuo', icon: '👹', line: '全部交出来！交不出来，牧场就归我了！' },
];

export function cardInfo(card: Card): { icon: string; name: string; desc: string; tag: string } {
  if (card.kind === 'creature') {
    const d = CREATURES[card.type];
    return { icon: d.icon, name: d.name, desc: d.desc + '；同家族邻居各+1', tag: FAMILIES[d.fam].name + '·' + ['', '普通', '稀有', '史诗'][d.r] };
  }
  if (card.kind === 'terrain') {
    const d = TERRAINS[card.type];
    return { icon: d.icon, name: d.name, desc: '把一块地变成' + d.name, tag: '地形' };
  }
  const d = ITEMS[card.type];
  return { icon: d.icon, name: d.name, desc: d.desc, tag: '道具' };
}
