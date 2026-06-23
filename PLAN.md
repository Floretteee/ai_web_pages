# Fimall Chat 前端动画打磨计划书

## 实施进度

- [x] A1：motion token 调整
- [x] A2：替换高频元素的 `transition: all`
- [x] A3：补充 active 态
- [x] A4：微交互提速与 hover 收敛
- [x] B2：消息入场动画微调
- [x] B3：流式输出动画修复
- [x] B4：点击回到底部平滑滚动
- [x] B1：消息列表 stagger
- [x] B5：滚动到底部按钮优化
- [x] C1：弹窗去回弹
- [x] C2：spinner 优化
- [x] C3：图标 hover 收敛
- [x] C4：会话切换 crossfade
- [ ] D/E：性能、可访问性、浏览器验收

## 目标

将当前项目的前端动效统一打磨为 **Apple 风格：柔和、克制、顺滑、低干扰**。

本计划仅记录后续实现方案，当前阶段不修改业务代码或样式代码。

## 当前诊断

项目是纯原生 HTML / CSS / JavaScript 的 AI 聊天 Web 应用。当前动画基础较好，已经具备：

- motion token：`--duration-*`、`--ease-*`
- 进入 / 退出时长区分
- `prefers-reduced-motion` 降级
- 消息入场使用 `transform + opacity`
- 部分组件使用 `will-change`

主要问题：

1. `transition: all` 与新 motion token 并存，动效语言不统一。
2. 微交互偏慢，按钮缺少明确 `:active` 按下反馈。
3. 会话切换 / 历史加载没有 stagger 入场，列表显得生硬。
4. 流式输出动画 `textPopIn` 时长过长且使用 `linear`，观感弱。
5. 点击回到底部时滚动体验不够精致。
6. 部分 spinner / hover 动效有廉价感或不够克制。
7. 弹窗使用 `ease-out-back`，与 Apple 风格的克制减速不完全一致。

## 设计原则

### 1. 克制优先

动画只用于解释状态变化，不做多余装饰。

### 2. 统一曲线

主曲线采用 Apple 风格强减速：

```css
cubic-bezier(0.32, 0.72, 0, 1)
```

用于按钮 hover、列表入场、弹窗入场、控件展开等大多数场景。

### 3. 微交互更快

- hover / focus：约 150ms
- press：约 80–100ms
- modal / drawer 入场：约 240–280ms
- modal / drawer 退场：约 160–200ms
- stagger 间隔：约 30–35ms

### 4. 只动画高性能属性

优先使用：

- `transform`
- `opacity`
- `box-shadow`（少量、克制）
- `background-color`
- `border-color`

避免动画：

- `width`
- `height`
- `top`
- `left`
- `margin`
- `padding`

### 5. 不滥用 spring / back

Apple 风格更偏「自然减速」，不是明显弹跳。除非有明确语义，否则避免 overshoot。

---

# 阶段 A：基础统一

## A1. 重构 motion token

涉及文件：

- `css/base.css`

计划：

1. 新增 Apple 风主曲线：

```css
--ease-standard: cubic-bezier(0.32, 0.72, 0, 1);
```

2. 新增或调整时长 token：

```css
--duration-press: 90ms;
--duration-micro: 150ms;
--duration-enter: 260ms;
--duration-exit: 180ms;
--duration-stagger: 32ms;
```

3. 保留已有曲线但重新定位用途：

- `--ease-standard`：默认 Apple 风动效
- `--ease-out-expo`：大元素强减速入场
- `--ease-in-expo`：退场
- `--ease-out-back`：保留但尽量不再用于主要组件
- `--ease-in-out`：少量双向状态切换

## A2. 替换 `transition: all`

涉及文件：

- `css/components/sidebar.css`
- `css/components/input.css`
- `css/components/chat.css`
- `css/components/settings.css`
- `css/components/overlays.css`
- `css/responsive.css`

目标：

将 `transition: var(--transition)` 或 `transition: all ...` 替换为显式属性声明。

示例方向：

```css
transition:
    background-color var(--duration-micro) var(--ease-standard),
    border-color var(--duration-micro) var(--ease-standard),
    color var(--duration-micro) var(--ease-standard),
    transform var(--duration-micro) var(--ease-standard),
    box-shadow var(--duration-micro) var(--ease-standard);
```

优先处理高频元素：

- 发送按钮
- 上传按钮
- 停止按钮
- 新建对话按钮
- 会话列表项
- 图标按钮
- 消息操作按钮
- 弹窗按钮
- 自定义选择器
- 滚动到底部按钮

## A3. 增加 `:active` 按下态

涉及文件：

- `css/components/input.css`
- `css/components/sidebar.css`
- `css/components/chat.css`
- `css/components/settings.css`
- `css/components/overlays.css`

计划为以下元素增加按下反馈：

- `.send-btn`
- `.stop-btn`
- `.upload-btn`
- `.new-chat-btn`
- `.icon-btn`
- `.chat-item`
- `.clear-chat-btn`
- `.action-icon`
- `.settings-close-btn`
- `.data-actions button`
- `.custom-modal button`

Apple 风建议：

```css
transform: scale(0.96);
transition-duration: var(--duration-press);
```

部分元素如果已有 `translateY`，则组合为：

```css
transform: translateY(0) scale(0.96);
```

## A4. 微交互提速与收敛

计划：

1. hover 时长统一到 `--duration-micro`。
2. 去掉不必要的 hover 放大效果。
3. 保留轻微上移：`translateY(-1px)` 或 `translateY(-2px)`。
4. hover 阴影控制在 `--shadow-soft` / `--shadow-mid`，避免过强。
5. `.send-btn:hover` 从 `translateY(-2px) scale(1.02)` 收敛为更克制的上移与阴影。

---

# 阶段 B：列表与流式输出

## B1. 消息列表 stagger 入场

涉及文件：

- `js/app.js`
- `css/components/chat.css`

当前问题：

新消息有 `animate-enter`，但切换会话 / 加载历史时，所有消息一次性出现，没有层次。

计划：

1. 为消息 wrapper 增加 CSS 变量索引：

```js
wrapper.style.setProperty('--stagger-index', index);
```

2. CSS 使用：

```css
animation-delay: calc(min(var(--stagger-index), 8) * var(--duration-stagger));
```

3. 只在以下场景启用 stagger：

- 首次渲染当前会话
- 切换会话
- 加载历史消息

4. 不在以下场景启用 stagger：

- 用户发送新消息
- bot 流式追加消息
- 自动重试时复用气泡

5. 延迟封顶：最多按 8 条计算，避免长历史消息等待过久。

## B2. 优化消息入场动画

涉及文件：

- `css/base.css`
- `css/components/chat.css`

当前：

```css
from { opacity: 0; transform: translateY(12px) scale(0.98); }
```

计划：

Apple 风建议改为更克制：

```css
from { opacity: 0; transform: translateY(8px) scale(0.985); }

to { opacity: 1; transform: translateY(0) scale(1); }
```

曲线使用：

```css
var(--ease-standard)
```

## B3. 修复流式输出 `textPopIn`

涉及文件：

- `css/base.css`
- `css/components/chat.css`

当前问题：

`textPopIn 1s linear` 太慢，且只做 opacity，流式场景中效果不明显。

计划：

1. 时长改为约 `280–320ms`。
2. 曲线改为 `--ease-standard`。
3. keyframe 增加极轻微位移：

```css
@keyframes textPopIn {
    from { opacity: 0; transform: translateY(2px); }
    to { opacity: 1; transform: translateY(0); }
}
```

4. 避免位移过大，防止正文阅读时抖动。

## B4. 平滑滚动到底部

涉及文件：

- `js/ui.js`

当前情况：

自动流式跟随使用 `scrollTop = scrollHeight`，这在流式高频场景是合理的，不能盲目改成 smooth，否则容易抖动。

计划：

1. 保留流式自动跟随的即时滚动。
2. 点击「回到底部」按钮时使用：

```js
scrollTo({ top: scrollHeight, behavior: 'smooth' })
```

3. 区分两个函数：

- 自动跟随：即时
- 用户点击：平滑

## B5. 优化滚动到底部按钮

涉及文件：

- `css/components/chat.css`

计划：

1. `.scroll-bottom-btn` transition 改为显式属性。
2. 入场使用 `opacity + transform`。
3. hover 更克制：`translateY(calc(-50% - 1px))`。
4. active 增加轻微 scale。

---

# 阶段 C：弹窗、spinner、细节动效

## C1. 弹窗去回弹

涉及文件：

- `css/components/settings.css`
- `css/components/overlays.css`

当前问题：

设置弹窗使用 `--ease-out-back`，有明显 overshoot，不够 Apple 风。

计划：

1. 入场从 `--ease-out-back` 改为 `--ease-standard`。
2. 保留：

```css
opacity: 0;
transform: translateY(12px) scale(0.97);
```

3. 进入：

```css
opacity: 1;
transform: translateY(0) scale(1);
```

4. 退场继续使用 `--ease-in-expo` 或适度改为标准 ease-in。

## C2. 优化 spinner

涉及文件：

- `css/base.css`
- `css/components/input.css`

当前问题：

`rotate 1s linear infinite` 观感偏廉价。

计划：

优先方案：

1. 调整 spinner 为稍快、更轻的节奏。
2. 避免匀速转圈过于机械。
3. 若仍不理想，改为脉冲点或骨架扫光。

备选方案：

推广已有 `textSweep` 为 loading skeleton，用于：

- 等待响应
- 文件上传
- 消息生成占位

## C3. 收敛图标 hover 动效

涉及文件：

- `css/components/sidebar.css`
- `css/components/settings.css`

计划：

1. `.icon-btn:hover` 当前 `rotate(15deg)` 可收敛为 `rotate(8deg)` 或改为纯背景反馈。
2. `.settings-close-btn:hover` 的 `rotate(90deg)` 有明确关闭语义，可保留。
3. 所有图标按钮增加 active 态。

## C4. 会话切换 crossfade

涉及文件：

- `js/app.js`
- `css/components/chat.css`

目标：

切换会话时，主聊天区不是直接替换，而是轻微淡出旧内容，再淡入新内容。

计划：

1. 增加容器状态类：

```css
.chat-messages.switching-out
.chat-messages.switching-in
```

2. 切换流程：

- 当前消息区 opacity 降到 0.96 或 0.92
- 替换 DOM
- 新消息区 opacity 恢复到 1
- 新消息按 stagger 入场

3. 时间控制：

- 淡出：80–120ms
- 淡入：160–220ms

4. 风险：

该项涉及渲染时序，可能影响滚动位置、搜索状态、历史加载。实现时应放在最后。

---

# 阶段 D：可访问性与性能验证

## D1. 保留 reduced motion

涉及文件：

- `css/base.css`

当前已有：

```css
@media (prefers-reduced-motion: reduce)
```

计划：

1. 保留全局兜底。
2. 新增的 stagger、crossfade、textPopIn 都必须被该规则覆盖。
3. reduced motion 下避免动画延迟导致内容出现变慢。

## D2. 检查 `will-change`

计划：

1. 只在真实需要的元素上保留 `will-change`。
2. 避免对大量列表项长期设置 `will-change`。
3. 如果 stagger 会导致大量消息项同时动画，应考虑动画结束后移除类或避免永久 will-change。

## D3. 性能验证

实现后需要验证：

1. Chrome / Edge Performance 面板录制。
2. CPU 4x throttle 下测试：
   - 发送消息
   - 流式输出
   - 切换会话
   - 打开设置弹窗
   - 移动端打开侧边栏
3. 检查是否有 layout thrashing。
4. 检查动画是否稳定 60fps。

---

# 阶段 E：测试与验收

## E1. 手动验收清单

### 按钮

- hover 是否快速、克制。
- active 是否有明确按下反馈。
- 禁用态是否无多余 transform。

### 消息

- 新消息入场是否自然。
- 切换会话是否有 stagger。
- 长历史是否不会因为 stagger 等待太久。
- 流式输出是否不抖动。

### 弹窗

- 设置弹窗入场是否柔和。
- 关闭是否快速。
- 不应有明显弹跳。

### 移动端

- 侧边栏滑入是否顺滑。
- backdrop 是否自然淡入。
- 点击遮罩关闭是否顺滑。

### 无障碍

- 开启 reduced motion 后，动画应接近关闭。
- 内容不应因为动画延迟而不可见。

## E2. 推荐验证命令

实现后应执行：

```bash
npm run lint
npm run typecheck
npm run build
```

如果项目没有对应脚本，则检查 `package.json` 后选择可用命令。

## E3. 浏览器验证

使用 Playwright 或手动浏览器验证以下路径：

1. 首屏加载。
2. 新建对话。
3. 发送消息。
4. 等待流式输出。
5. 点击回到底部。
6. 打开 / 关闭设置。
7. 移动端宽度打开侧边栏。
8. 切换多个历史会话。

---

# 推荐实施顺序

1. A1：motion token 调整。
2. A2：替换高频元素的 `transition: all`。
3. A3：补充 active 态。
4. A4：微交互提速与 hover 收敛。
5. B2：消息入场动画微调。
6. B3：流式输出动画修复。
7. B4：点击回到底部平滑滚动。
8. B1：消息列表 stagger。
9. B5：滚动到底部按钮优化。
10. C1：弹窗去回弹。
11. C2：spinner 优化。
12. C3：图标 hover 收敛。
13. C4：会话切换 crossfade。
14. D / E：性能、可访问性、浏览器验收。

---

# 风险分级

## 低风险

- token 调整
- transition 显式化
- active 态
- hover 提速
- 弹窗曲线替换
- spinner 微调

## 中风险

- 流式输出动画
- 点击回到底部平滑滚动
- 消息 stagger

## 高风险

- 会话切换 crossfade

高风险项建议最后实现，并单独提交。

---

# 建议提交拆分

后续实现时建议分 4 个提交：

1. `refactor motion tokens and micro interactions`
2. `improve message animations and streaming feedback`
3. `polish modal sidebar and loading animations`
4. `add chat switching transition`

每个提交后单独验证，避免动画问题混在一起难以回滚。
