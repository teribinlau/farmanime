// 自动对局测试：npx tsx tools/sim.ts
// naive = 随手摆；greedy = 每步选让「今晚预计收入」最高的放法
import { RanchGame } from '../src/core/RanchGame';

function play(smart: boolean, endless = false) {
  const g = new RanchGame(); g.newGame();
  let guard = 0;
  while (g.mode !== 'over' && (g.mode !== 'win' || endless) && guard++ < 2000) {
    if (g.mode === 'win') { g.continueEndless(); continue; }
    if (g.mode === 'rent') { g.payRent(); continue; }
    if (g.mode === 'relic') { g.chooseRelic(g.relicChoices[0]); continue; }
    while (g.choices.length) {
      let bestV = -1, bk = -1, bi = -1;
      if (smart) {
        g.choices.forEach((c, k) => g.board.forEach((_, i) => {
          if (!g.canPlace(c, g.board[i])) return;
          const snap = JSON.stringify({ b: g.board, ch: g.choices, coins: g.coins, p: g.picksLeft, pl: g.pool, n: g.info });
          g.selected = k; g.tapCell(i);
          let v = g.previewIncome() * 7 + g.coins;
          if (c.kind === 'creature' && c.type === 'dragon') v += 40;
          const s = JSON.parse(snap); g.board = s.b; g.choices = s.ch; g.coins = s.coins; g.picksLeft = s.p; g.pool = s.pl; g.info = s.n; g.selected = -1;
          if (v > bestV) { bestV = v; bk = k; bi = i; }
        }));
      } else {
        bk = Math.max(0, g.choices.findIndex((c) => c.kind === 'creature'));
        bi = g.board.findIndex((cell) => g.canPlace(g.choices[bk], cell));
      }
      if (bk < 0) break;
      const before = g.choices.length;
      g.tapCard(bk);
      if (bi >= 0) g.tapCell(bi); else g.tapCard(bk); // 无目标道具：再点一次使用
      if (g.selected >= 0) g.deselect();
      if (g.choices.length === before) break; // 这张卡用不了，今天不选了
    }
    g.endDay();
  }
  return g.mode === 'over' ? g.weeksSurvived : g.week;
}

for (const smart of [false, true]) {
  const hist: Record<number, number> = {};
  for (let n = 0; n < 150; n++) { const w = play(smart); hist[w] = (hist[w] || 0) + 1; }
  console.log(smart ? 'greedy' : 'naive', '撑过的周数分布', JSON.stringify(hist));
}

const hist: Record<number, number> = {};
for (let n = 0; n < 150; n++) { const w = play(true, true); hist[w] = (hist[w] || 0) + 1; }
console.log('greedy+无尽', '撑过的周数分布', JSON.stringify(hist));
