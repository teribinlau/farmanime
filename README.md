# 群芳牧场

乱世三国里，和三国美少女们一起经营牧场的微信小游戏。用原生 Canvas 2D 编写，不依赖游戏引擎和编辑器，在云端就能完成打包。

玩法设计见 [DESIGN.md](DESIGN.md)。

## 打包
```bash
npm install
npm run build        # 生成 build/minigame（微信小游戏目录）和 build/web（浏览器试玩版）
npm run typecheck    # 类型检查
npm run sim          # 自动对局测试，看难度曲线
node test/play.js    # 无头浏览器从头玩到尾，截图在 test/shots/
```
打包后还会生成 `build/qunfang-ranch.html`：图片全部内嵌的单文件试玩版，手机上直接打开就能玩。
打包需要 Node 18+ 和 Python 3 + Pillow（用来压缩图片）。

## 目录
- `src/core/`：规则逻辑和数据，不依赖平台。调数值改 `src/core/Data.ts`
- `src/main.ts`：绘制和触摸（微信小游戏 API）
- `web/index.html`：浏览器试玩用的简化 wx 模拟层
- `minigame/`：小游戏配置（`game.json`、`project.config.json`，上传前把 appid 换成你自己的）
- `art/`：美术原图。文件名就是游戏里的 key，比如 `hero_zhaoyun.png`。打包时会自动压缩，人物还会自动裁一张头像
- `tools/`：出图提示词、图片压缩、自动对局脚本

## 美术
- 人物立绘：女主 `heroine`，9 位伙伴 `hero_*`，8 位诸侯 `lord_*`，已经完成
- 动物、地块、道具图标：还没做，游戏里暂时用 emoji。做好后放进 `art/`，按 `tools/art_prompts.json` 里的 key 命名就会自动替换

## 上传到微信（以后）
在微信公众平台「开发管理 → 开发设置」里生成代码上传密钥，然后就可以用官方的 `miniprogram-ci` 在云端把 `build/minigame` 上传成体验版，全程不需要电脑。
