const { chromium } = require('playwright'); const path=require('path');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:375,height:667}});const errs=[];p.on('pageerror',e=>errs.push(String(e)));
await p.goto('file://'+path.resolve('build/qunfang-ranch.html'));await p.waitForTimeout(800);
await p.evaluate(()=>{const g=window.__game;g.newGame();let n=0;while(!['over','win'].includes(g.mode)&&n++<200){if(g.mode==='rent'){g.payRent();continue;}if(g.mode==='relic'){g.chooseRelic(g.relicChoices[0]);continue;}g.endDay();}});
await p.waitForTimeout(1200);await p.screenshot({path:'test/shots/07_end_over_small.png'});
console.log(JSON.stringify({mode:await p.evaluate(()=>window.__game.mode),errs}));await b.close();})();
