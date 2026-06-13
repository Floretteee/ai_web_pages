# Fimall Chat

一个简洁优雅的 AI 聊天 Web 应用，支持多对话管理、Markdown 渲染、代码高亮、LaTeX 公式、HTML/Markdown/JSON 导出等功能。

## 功能特性

- **多对话管理** — 侧边栏创建、切换、重命名、删除对话
- **Markdown 渲染** — 基于 DOMD + KaTeX，支持高性能 Markdown 预览和数学公式
- **消息队列** — 批量输入消息，排队依次发送
- **图片上传** — 支持在消息中附加图片
- **角色预设** — 内置多种 prompt 预设，一键切换对话风格
- **思考过程折叠** — 自动识别并折叠 `<think>` 标签内容
- **导出功能**
  - **HTML 导出** — 落叶知秋（暖色和风）/ 清风明月（GitHub 风格）双主题
  - **Markdown 导出** — 保留格式的 .md 文件
  - **JSON 导出** — 完整聊天记录备份
- **数据持久化** — 本地存储，刷新不丢失

## 使用

1. 填入 API Key 并获取模型列表
2. 选择对话模型（和可选的标题生成模型）
3. 开始聊天

所有数据保存在浏览器 `localStorage` 中。

## 部署

本项目为纯静态站点，可部署到任意静态托管服务。

### Cloudflare Pages

```bash
# 安装 wrangler
npm install -g wrangler

# 部署
wrangler pages deploy . --project-name=fimall-ai-web
```

线上地址：https://fimall-ai-web.pages.dev

### 自行托管

直接将项目文件放到任意 HTTP 服务器即可使用。

## 技术栈

核心运行时为纯原生 HTML / CSS / JavaScript，构建阶段使用 esbuild 处理 DOMD 渲染器。
