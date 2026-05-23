每次大修改后必须执行以下操作：

1. git add . && git commit -m "描述本次修改内容"
2. git push
3. wrangler pages deploy . --project-name=fimall-ai-web
