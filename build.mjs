// 一键打包：node build.mjs
//   build/minigame/  用微信开发者工具或 miniprogram-ci 上传的小游戏目录
//   build/web/       手机浏览器试玩版（同一份 game.js + 一个简化的 wx 模拟层）
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';

rmSync('build', { recursive: true, force: true });
mkdirSync('build/minigame', { recursive: true });
mkdirSync('build/web', { recursive: true });

// 压缩图片（需要 python3 + pillow），并把实际存在的图片列表写进代码，避免请求不存在的图
if (existsSync('art')) execFileSync('python3', ['tools/build_art.py', 'build/minigame/images'], { stdio: 'inherit' });
const images = existsSync('build/minigame/images')
  ? readdirSync('build/minigame/images').filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4))
  : [];

await build({
  define: { __IMAGES__: JSON.stringify(images) },
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2017',
  minify: true,
  outfile: 'build/minigame/game.js',
  legalComments: 'none',
});

cpSync('minigame', 'build/minigame', { recursive: true });
cpSync('build/minigame/game.js', 'build/web/game.js');
if (existsSync('build/minigame/images')) cpSync('build/minigame/images', 'build/web/images', { recursive: true });
cpSync('web/index.html', 'build/web/index.html');
execFileSync('python3', ['tools/make_single_html.py', 'build/web', 'build/qunfang-ranch.html'], { stdio: 'inherit' });
console.log('done: build/minigame, build/web');
