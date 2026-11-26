// 用无头浏览器把单文件版从头玩到尾，截图到 test/shots/
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const file = 'file://' + path.resolve(process.argv[2] || 'build/qunfang-ranch.html');
const out = path.resolve('test/shots'); fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(file);
  await page.waitForTimeout(1500);
  const shot = (n) => page.screenshot({ path: path.join(out, n + '.png') });
  const tapBtn = async (pred) => {
    const b = await page.evaluate((src) => {
      const f = new Function('b', 'return ' + src);
      return window.__buttons().find((b) => f(b)) || null;
    }, pred);
    if (!b) return false;
    await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
    await page.waitForTimeout(80);
    return true;
  };
  const loaded = await page.evaluate(() => Object.keys(window.__INLINE_IMAGES).length);
  await shot('01_title');
  // 标题页只有一个按钮
  await tapBtn('true');
  await page.waitForTimeout(300);
  await shot('02_play');
  const mode = () => page.evaluate(() => window.__game.mode);
  let guard = 0, shotRent = false, shotRelic = false, firstPlace = false;
  while (!['over', 'win'].includes(await mode()) && guard++ < 400) {
    const m = await mode();
    if (m === 'rent') {
      await page.waitForTimeout(1000);
      if (!shotRent) { await shot('04_rent'); shotRent = true; }
      await page.evaluate(() => window.__game.payRent()); continue;
    }
    if (m === 'relic') {
      if (!shotRelic) { await shot('05_relic'); shotRelic = true; }
      await page.evaluate(() => window.__game.chooseRelic(window.__game.relicChoices[0])); continue;
    }
    // 贪心摆放（走规则层），第一次用真实点击
    await page.evaluate(() => {
      const g = window.__game;
      let guard = 0;
      while (g.choices.length && guard++ < 10) {
        let bestV = -1, bk = -1, bi = -1;
        g.choices.forEach((c, k) => g.board.forEach((_, i) => {
          if (!g.canPlace(c, g.board[i])) return;
          const snap = JSON.stringify({ b: g.board, ch: g.choices, coins: g.coins, p: g.picksLeft });
          g.selected = k; g.tapCell(i);
          const v = g.previewIncome() * 7 + g.coins;
          const s = JSON.parse(snap); g.board = s.b; g.choices = s.ch; g.coins = s.coins; g.picksLeft = s.p; g.selected = -1;
          if (v > bestV) { bestV = v; bk = k; bi = i; }
        }));
        if (bk < 0) break;
        const before = g.choices.length;
        g.tapCard(bk); if (bi >= 0) g.tapCell(bi); else g.tapCard(bk);
        if (g.selected >= 0) g.deselect();
        if (g.choices.length === before) break;
      }
    });
    if (!firstPlace) { await page.waitForTimeout(200); await shot('03_placed'); firstPlace = true; }
    // 真实点击「结束今天」
    await page.waitForTimeout(950);
    const ok = await tapBtn("b.y > 700 && b.w > 300");
    if (!ok) await page.evaluate(() => window.__game.endDay());
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => ({ mode: window.__game.mode, weeks: window.__game.weeksSurvived, relics: window.__game.relics.length }));
  await shot('06_end_' + st.mode);
  // 再来一局 -> 回到游戏
  await tapBtn("b.h === 48 && b.w < 330");
  const again = await mode();
  console.log(JSON.stringify({ images: loaded, final: st, againMode: again, errors }));
  await browser.close();
})();
