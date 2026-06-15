# Fimall Chat 改进计划

> 本计划排除安全/隐私相关项（API Key 存储、CSP、XSS 审计等）。以下聚焦代码结构、性能、工程化、可访问性与 UI 体验。

## 一、代码结构重构

### 1.1 拆分 app.js ✅
- **现状**：~~`app.js` 共 1619 行，状态、网络、渲染、导出、队列、UI 全部耦合。~~ 已完成。
- **目标**：拆分为多个职责单一的模块。
  - `js/utils.js`：常量正则、转义、节流、资源加载。
  - `js/state.js`：全局状态初始化、读取、持久化、DOM 收集。
  - `js/api.js`：`fetchModels`、`executeChatRequest`、`generateTitle`、`stopGeneration`。
  - `js/renderer.js`：Markdown/Math/代码高亮、`renderContentWithThink`、原生导出渲染。
  - `js/export.js`：HTML/Markdown/JSON 导入导出。
  - `js/queue.js`：消息队列逻辑。
  - `js/ui.js`：侧边栏、设置面板、右键菜单、自定义 select、toast/confirm、滚动控制。
  - `js/app.js`：对话/消息 CRUD、`init`、渲染调度、事件挂载。
- **验证标准**：每个模块行数控制在 400 行以内（已达成，最长 app.js ≈412 行）。

### 1.2 统一状态管理
- **现状**：`state` 为全局可变对象，多处直接修改字段。
- **目标**：
  - 所有写操作通过 `updateState(patch)` 或专用 action 函数完成。
  - 已引入 `immer`，可借机使用不可更新模式减少深拷贝BUG。
  - 将 `_lastRenderedContent` 等运行时临时字段从持久化对象中剥离。

### 1.3 抽象 UI 组件 ✅
- **现状**：~~toast、confirm、context menu、custom select 等均由原生 DOM API 拼写。~~ 已完成。
- **目标**：
  - 为重复 UI 模式建立轻量级工厂函数，例如 `createToast(message)`、`createConfirm(message)`。
  - 自定义 select 补齐键盘导航与 ARIA 状态。
- **完成内容**：
  - 新建 `js/components.js`，封装 `Components` 工厂模块（IIFE），提供 `createToast`、`createConfirm`、`createCustomSelect`、`createContextMenu` 等工厂函数。
  - Toast：增加 `role="status"` / `aria-live="polite"`，支持自定义 duration。
  - Confirm：增加 `role="dialog"` / `aria-modal="true"` / focus trap / Esc 关闭 / 自动聚焦确认按钮。
  - Custom Select：完整键盘导航（↑/↓/Enter/Escape/Home/End），`role="combobox"` / `aria-expanded` / `role="listbox"` / `role="option"` / `aria-selected` / `aria-activedescendant`，hover 高亮联动。
  - Context Menu：增加 `role="menu"` / `role="menuitem"` / `tabindex`，支持 ↑/↓ 方向键聚焦、Esc 关闭，边界溢出自动调整位置。
  - 底部保留全局函数别名（`showToast`、`showConfirm` 等）确保向后兼容。
  - 重构 `js/ui.js`，移除原有内联实现，仅保留非组件 UI 逻辑。
  - CSS 补齐 `.highlighted` 和 `:focus` 状态样式。

## 二、性能与存储

### 2.1 聊天记录持久化升级 ✅
- **现状**：~~`localStorage` 序列化全部聊天记录，大 base64 图片极易撑爆 5-10MB 限制。~~ 已完成，迁移到 IndexedDB。
- **目标**：
  - ~~主数据迁移到 IndexedDB，使用 `idb` 或原生 IndexedDB 封装。~~ 已完成，使用原生 IndexedDB 封装于 `js/db.js`。
  - ~~`localStorage` 仅保留轻量配置（模型、主题、 preset 名等）。~~ 已完成，聊天数据写入 IndexedDB，localStorage 仅作回退。
  - 图片不再以 base64 原样累加（待后续处理）。

### 2.2 消息列表虚拟滚动或分页 ✅
- **现状**：~~长对话所有消息一次性挂载在 DOM 中，滚动与重渲染都会越来越慢。~~ 已完成（分页实现）。
- **目标**：
  - ~~首屏只渲染最近 N 条（如 50 条），向上滚动时动态加载历史。~~ 已完成。
  - 或引入虚拟滚动（自行实现或引入轻量库），仅渲染可视区域内的消息。
- **完成内容**：
  - `js/app.js` 中加入 `MESSAGE_PAGE_SIZE = 50` / `MESSAGE_PAGE_STEP = 50` 与 `_visibleCounts` Map 维护每个聊天的当前可见条数（运行时状态，不持久化）。
  - `renderMessages` 仅渲染最近 N 条消息，超出部分在顶部插入"加载更早的消息（剩余 X 条）"按钮，点击后增量加载并保持滚动位置不跳动。
  - 切换聊天时通过 `switchChat` 重置可见条数为 50，避免长对话切换卡顿。
  - 增量追加路径同步增加 chatId 一致性、load-more 按钮存在性校验，避免误判导致 DOM 错乱。
  - `css/components/chat.css` 加入 `.load-more-history-btn` 玻璃拟态样式，含 hover/focus-visible 状态。

### 2.3 渲染性能优化 ✅
- **现状**：~~`renderMessages` 虽有增量追加逻辑，但 `msgs.slice(0, existingWrappers.length).every(...)` 每次遍历生成 JSON.stringify 比较，流量大时仍有开销。~~ 已完成。
- **目标**：
  - ~~给消息引入稳定版本戳/version，比较版本号而非字符串化内容。~~ 已完成。
  - ~~`executeChatRequest` 中 scheduler 刷新可降低频率（如 60ms → 120ms），减少大段 Markdown 重复渲染。~~ 已完成。
- **完成内容**：
  - `js/app.js` `renderMessages` 中将 `_lastRenderedContent` 字符串化对比改为 `_renderVersion` / `_lastRenderedVersion` 数值版本戳对比，避免每次重渲染都 `JSON.stringify` 全部已渲染消息内容；新消息首次渲染后版本戳同步为 0，后续仅在内容变更时递增。
  - `saveEdit` 在保存修改时递增 `_renderVersion`，使下一次 `renderMessages` 落入全量重绘分支，正确反映编辑结果。
  - `forkChat` 克隆与 `state.js` 持久化（`_saveStateSync` / `loadChatsFromDB` 迁移路径）同步剥离运行时字段 `_renderVersion` / `_lastRenderedVersion` / `_lastRenderedContent`，避免污染 IndexedDB / localStorage 数据。
  - `js/api.js` 流式调度 `setTimeout` 节流从 30ms 提高到 120ms，长文本生成时显著降低主线程被 Markdown 重渲染占用的时长。

### 2.4 节流/防抖优化 ✅
- **现状**：~~`throttledKeepMobileVisible` 使用 setTimeout，节流精度一般。~~ 已完成。
- **完成内容**：
  - `js/ui.js`：`keepMobileComposerVisible` 从 `setTimeout` 节流升级为 `requestAnimationFrame` 节流（`_vvRafId` 去重）。
  - `scrollToBottom` 同样改为 rAF 单帧防抖（`_scrollRafId` 去重）。
  - 此项在 6.4 动画系统重构中一并完成。

## 三、工程化与构建

### 3.1 自动化代码规范
- **目标**：
  - 引入 ESLint + Prettier，避免全局变量污染、未使用变量、隐式类型转换等问题。
  - 添加 `lint`、`format` npm scripts。
  - 推荐在 Git 仓库配置 pre-commit hook（如 `lint-staged`）。

## 四、错误处理与可靠性

### 4.1 请求超时控制
- **现状**：API 调用没有 timeout，网络异常时仅有 fetch 原生失败。
- **目标**：
  - 所有 `fetch` 使用 `AbortSignal.timeout(ms)` 或手动包装 timeout。
  - 模型列表、对话请求、标题生成分别设置合理超时。

### 4.2 网络状态感知
- **目标**：监听 `navigator.onLine`，离线时禁用发送按钮并提示；恢复后自动刷新模型列表。

### 4.3 更友好的错误提示
- **现状**：`showToast("消息请求失败，请重试")` 信息过于笼统。
- **目标**：区分 HTTP 状态码（401/429/500/503）、网络断开、超时，给出不同提示。

## 五、可访问性（a11y）

### 5.1 自定义组件键盘支持
- **自定义 select**：~~打开后支持 ↑/↓ 选择、Enter 确认、Esc 关闭。~~ ~~维护 `aria-expanded`、`aria-selected`。~~ 已完成（1.3 抽象 UI 组件中实现）。
- **右键菜单**：~~支持 Esc 关闭、方向键聚焦。~~ 已完成（1.3 抽象 UI 组件中实现）。
- **模态框（设置/聊天设置）**：
  - 打开时焦点移入首个可聚焦元素。
  - Tab 键限定在模态框内循环（focus trap）。
  - 关闭后焦点回到触发元素。

### 5.2 语义化增强
- 消息列表使用 `role="log"`、`aria-live="polite"`，新增消息时屏幕阅读器可自动朗读。
- 发送按钮增加 `aria-label`，生成中时改为“停止生成”。

## 六、UI 体验与丝滑过渡动画 (流畅性优化)

### 6.1 动画设计语言与性能规范 (Motion Design System) ✅
1. **动画基本原则 (Motion Principles)**
   - **空间连续性**：动画必须提供物理和视觉上的因果关系（例如模态框应从触发源原位缩放淡入，侧边栏应从屏幕外平滑推入）。
   - **GPU 硬件加速**：所有动画过渡仅对 `transform` 和 `opacity` 进行处理，严禁动画 `width`、`height`、`top`、`left`、`margin` 等属性，以防止浏览器触发重排 (Reflow) 导致掉帧。
   - **交互响应性**：动画必须是可中断的 (Interruptible)，用户在动画进行中点击或滑动应能立刻交互。退出动画时长应比进入动画短 30%~40%（感觉更轻快）。

2. **核心动画参数 (CSS 变量设计)**
   ```css
   :root {
     /* 动画时长 (Duration) */
     --duration-micro: 150ms;   /* 微交互: 悬停 hover、激活 active */
     --duration-enter: 280ms;   /* 进入/展开: 模态框 modal-open、侧边栏 sidebar-open */
     --duration-exit: 180ms;    /* 退出/关闭: 模态框 modal-close、侧边栏 sidebar-close */
     --duration-stagger: 35ms;  /* 列表项交错渲染延迟 */

     /* 缓动函数 (Easing) */
     --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);    /* 极致丝滑减速曲线，适合淡入和展开 */
     --ease-in-expo: cubic-bezier(0.7, 0, 0.84, 0);     /* 极致加速曲线，适合淡出和收起 */
     --ease-out-back: cubic-bezier(0.34, 1.56, 0.64, 1); /* 微弹簧超调曲线，用于交互点击反馈 */
     --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);      /* 对称平滑曲线，用于一般非突变过渡 */
   }
   ```

### 6.2 关键组件丝滑过渡动画示例代码 (Example Implementations) ✅
1. **侧边栏抽屉式滑入滑出**
   ```css
   .sidebar {
     will-change: transform;
     transition: transform var(--duration-enter) var(--ease-out-expo);
     transform: translateX(-100%);
   }
   .sidebar.active {
     transform: translateX(0);
   }
   .sidebar.exiting {
     transition-duration: var(--duration-exit);
     transition-timing-function: var(--ease-in-expo);
     transform: translateX(-100%);
   }
   ```
2. **毛玻璃模态框渐变与弹簧缩放**
   ```css
   .modal-backdrop {
     will-change: backdrop-filter, background-color;
     backdrop-filter: blur(0px);
     background-color: rgba(0, 0, 0, 0);
     transition: backdrop-filter var(--duration-enter) var(--ease-out-expo),
                 background-color var(--duration-enter) var(--ease-out-expo);
   }
   .modal-backdrop.active {
     backdrop-filter: blur(12px);
     background-color: rgba(0, 0, 0, 0.4);
   }
   .modal-content {
     will-change: transform, opacity;
     transform: scale(0.95) translateY(12px);
     opacity: 0;
     transition: transform var(--duration-enter) var(--ease-out-back),
                 opacity var(--duration-enter) var(--ease-out-expo);
   }
   .modal-content.active {
     transform: scale(1) translateY(0);
     opacity: 1;
   }
   .modal-content.exiting {
     transition: transform var(--duration-exit) var(--ease-in-expo),
                 opacity var(--duration-exit) var(--ease-in-expo);
     transform: scale(0.95) translateY(12px);
     opacity: 0;
   }
   ```
3. **消息气泡流交错淡入 (Staggered Entrance)**
   ```css
   @keyframes msg-fade-in {
     from {
       opacity: 0;
       transform: translateY(12px) scale(0.98);
     }
     to {
       opacity: 1;
       transform: translateY(0) scale(1);
     }
   }
   .message-item {
     animation: msg-fade-in var(--duration-enter) var(--ease-out-expo) both;
   }
   /* 动态交错延迟 */
   .message-item {
     animation-delay: calc(var(--msg-index, 0) * var(--duration-stagger));
   }
   ```
4. **JS 级防抖滚动与 requestAnimationFrame 控制**
   ```javascript
   // 避免在消息连续生成时高频触发 scrollTo 导致重绘阻塞
   let isScrollTicking = false;
   function smoothScrollToBottom(container) {
     if (isScrollTicking) return;
     isScrollTicking = true;
     requestAnimationFrame(() => {
       container.scrollTo({
         top: container.scrollHeight,
         behavior: 'smooth'
       });
       isScrollTicking = false;
     });
   }
   ```

### 6.3 网页流畅性保障 (Jank-free Execution) ✅
1. **消除布局抖动 (Layout Thrashing)**：严禁在动画执行或连续滚动期间混用 DOM 读取（如 `scrollTop`, `getBoundingClientRect`）与 DOM 写入（如修改 style）。读取必须做缓存或防抖，写入必须使用 `requestAnimationFrame` 批处理。
2. **列表虚拟化与分片重绘**：结合 2.2 消息分页渲染，控制可视区域 DOM 树的节点数，避免深层 DOM 频繁进行无效重绘。
3. **合理配置 `will-change`**：在 `.sidebar`、`.modal-content` 等经常做变换的元素上启用硬件加速，但在动画结束后或普通元素上不应滥用，防止 GPU 显存过载。
4. **控制流式生成时的渲染频率**：在 `executeChatRequest` 中，调整流式 markdown 解析频率（如 100ms - 150ms 渲染一次），避免长文本生成时主线程被垃圾回收 (GC) 和大量 Markdown 转 DOM 阻塞。

### 6.4 现有项目动画专项改造方案与示例代码 (Refactoring Roadmap) ✅
针对目前项目中存在的动画性能和过渡生硬问题，已按以下重构路径完成精确的代码修改：

**完成内容**：
- `css/base.css`：新增统一动画 token（`--duration-micro/enter/exit/stagger`、`--ease-out-expo/in-expo/out-back/in-out`），新增 `@keyframes msgFadeIn`，加入 `prefers-reduced-motion` 适配。
- `css/components/sidebar.css`：`.sidebar-backdrop` 改为 `opacity + visibility + pointer-events + backdrop-filter` 联动机制，进入用 `--ease-out-expo`，退出（`.exiting`）用 `--ease-in-expo`，废除 `display:none` 硬切。
- `css/responsive.css`：移动端 `.sidebar` 加 `will-change:transform`，进入 `--duration-enter/--ease-out-expo`，`.exiting` 走 `--duration-exit/--ease-in-expo`；PC 端遮罩用 `visibility/opacity` 隐藏而非 `display:none`，避免破坏过渡。
- `css/components/settings.css`：设置 / 聊天设置面板 + 遮罩进出分流，进入 transform 用 `--ease-out-back` 弹簧曲线，退出统一用 `--ease-in-expo` 加速曲线，背景 backdrop-filter 平滑淡入淡出。
- `css/components/chat.css`：剥离 `.message-wrapper` 默认 `animation`，仅 `.animate-enter` 触发 `msgFadeIn` 进场，避免历史 50 条同时渲染卡顿。
- `js/app.js`：`createMessageDOM(msg, index, isNew)` 新增第三参数；`renderMessages` 增量追加分支统一 `isNew=true`，全量重绘分支根据 `_lastRenderMsgCount` 判断尾部新消息是否首次渲染。
- `js/api.js`：流式机器人气泡 `createMessageDOM(..., true)` 启用进场动画。
- `js/ui.js`：`scrollToBottom` 改用 `requestAnimationFrame` 单帧防抖；`keepMobileComposerVisible` 从 `setTimeout` 节流升级为 rAF 节流；`closeSidebar` / `closeSettings` / `closeChatSettings` 增加 `.exiting` 类完成"进出分流"，过渡结束自动清理。

### 6.5 深色模式 ✅
- **目标**：
  - 添加 `data-theme` 属性切换，所有 CSS 变量支持暗色值。
  - 用户偏好持久化到 `localStorage`。
  - 跟随系统 `prefers-color-scheme`。
- **完成内容**：
  - `css/base.css`：扩展完整语义化 CSS 变量体系（`--surface-1/2/3/hover/active`、`--border-soft/mid/strong`、`--text-tertiary/muted`、`--accent-text/hover`、`--shadow-soft/mid/strong`、`--code-bg/text/border`、`--inline-code-bg/on-user`、`--think-bg/border/text/summary`、`--message-bot-shadow`、`--backdrop-overlay/modal`、`--danger/strong` 等 30+ 变量）。
  - `html[data-theme="dark"]`：完整暗色值覆盖，含 `color-scheme: dark` 浏览器原生适配。
  - 所有组件 CSS（sidebar/chat/input/settings/overlays/responsive）硬编码颜色替换为 CSS 变量引用。
  - 设置面板新增「外观 > 主题」section，提供"跟随系统 / 浅色 / 深色"三选。
  - `js/ui.js`：实现 `setTheme()` / `applyTheme()` / `initTheme()`，localStorage 持久化，`matchMedia('(prefers-color-scheme: dark)')` 监听系统切换自动应用。
  - `meta[name=theme-color]` 联动更新，适配移动端浏览器地址栏颜色。

### 6.6 消息搜索 ✅
- **目标**：~~在侧边栏或聊天顶部增加搜索框，按关键字过滤当前对话消息。~~ 已完成。
- **完成内容**：
  - `index.html`：chat-header 新增搜索按钮（放大镜图标），点击展开/收起搜索栏。
  - `css/components/chat.css`：新增 `.search-bar` / `.search-toggle-btn` / `.search-hidden` / `.search-highlight` 样式，搜索栏支持响应式适配。
  - `js/app.js`：实现 `toggleSearch(forceOpen)` / `clearSearch()` / `handleSearch(query)`，rAF 防抖；匹配项高亮 `.search-highlight`，不匹配项隐藏 `.search-hidden`，结果计数显示。
  - 快捷键支持：`Ctrl/Cmd+F` 打开搜索，`Esc` 关闭搜索。
  - 切换聊天时自动 `clearSearch()` 清除搜索状态。

### 6.7 代码块一键复制 ✅
- **目标**：~~每个 `<pre>` 右上角增加复制按钮，复制代码原文到剪贴板。~~ 已完成。
- **完成内容**：
  - `js/renderer.js`：`highlightCodeBlocks()` 末尾调用 `addCopyButtons(container)`，为每个 `<pre>` 动态注入 `.code-copy-btn`；新增独立 `addCopyButtons()` 函数确保无语法高亮的 `<pre>` 也能获得复制按钮。
  - 点击复制调用 `navigator.clipboard.writeText()`，成功后图标切换为勾号，2 秒后恢复。
  - `css/components/chat.css`：`.code-copy-btn` 绝对定位于 `pre` 右上角，默认 `opacity:0`，hover `pre` 时显示；暗色代码块半透明背景适配，`.copied` 状态绿色勾号反馈。

### 6.8 输入限制与提示
- 增加 `maxlength`（如 8000）与字符计数.
- 粘贴大段文本时给出提示。

### 6.9 模型列表缓存
- **目标**：获取成功后缓存模型列表与最后更新时间，24h 内不再重复请求；用户可手动刷新。

### 6.10 导入合并而非覆盖
- **现状**：导入 JSON 直接覆盖全部聊天记录。
- **目标**：提供“合并导入”选项，按对话 ID 去重或新增；保留覆盖选项供高级用户选择。

### 6.11 队列体验优化
- 当前队列图标默认隐藏，仅在生成中显示，发现性较低。
- 目标：队列按钮常驻，有队列项时显示 badge；支持拖拽排序。

## 七、测试

- **目标**：
  - 单元测试：Markdown 解析/导出、过滤模式、状态序列化。
  - 端到端测试：使用 Playwright 验证新建对话、发送消息、导出流程。
  - 至少覆盖关键路径：发送→接收→保存→刷新不丢失。

## 八、实施顺序建议

1. **先做低风险高价值**：~~清理未使用依赖~~、~~统一 README~~、~~SW 版本管理~~、~~CSS 拆分~~。
2. **再做结构**：~~拆分 `app.js`~~、~~抽象 UI 组件~~。
3. **接着性能**：~~IndexedDB 迁移~~、~~消息列表分片渲染~~、~~渲染性能优化（版本戳 + 流式节流）~~、~~动画系统重构（6.1-6.4）~~。
4. **最后体验**：~~深色模式~~、~~搜索~~、~~复制代码块~~、测试。

## 附录：暂不涉及

- 安全/隐私相关改造（按项目方要求跳过）。
- `presets.js`  prompt 内容本身（仅改进 preset 系统的技术架构可在后续单独进行）。
