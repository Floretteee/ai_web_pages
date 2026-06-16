每次大修改后必须执行以下操作：

1. npm run build:sw（构建 Service Worker，替换版本号和缓存戳）
2. git add . && git commit -m "描述本次修改内容"
3. git push
4. wrangler pages deploy . --project-name=fimall-ai-web

也可以用 npm run deploy 一步完成步骤1+4。

SW 版本管理：
- sw.template.js 是源模板（含 __VERSION__ / __CACHE_BUST__ 占位符）
- npm run build:sw 从模板生成 sw.js（读取 package.json 版本号 + 时间戳）
- 升级版本：npm run release（patch）或 node scripts/bump-version.mjs minor/major
