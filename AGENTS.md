# AGENTS.md — dsh-file-extra 开发指南与规范

> 面向后续开发者与 AI Agent：动手前先通读本文件。**任何接口性变更（DOM 选择器 / 路由 / URL 规则 / 交互流程）必须同步更新 README.md 与本文件。**

## 1. 项目定位

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）独立插件，整合了此前三个独立插件的全部能力：

| 原插件 | 能力 | 现状 |
|--------|------|------|
| `dsh-file-upload` | 文件树头上传按钮（POST 原始字节） | 并入本插件，路由改为 `/api/dsh-file-extra/upload` |
| `dsh-file-download` | 文件行下载按钮（HEAD 预检 + anchor 保存） | 并入本插件 |
| `dsh-file-comment` | 预览选区评论并投递到会话输入框 | 并入本插件 |
| — | 文件行删除按钮 | 本插件新增 |
| — | 侧边栏 tab 右键菜单：关闭全部 / 关闭其他 | 本插件新增（官方席位 `sidebar.right.tab.menu.item`） |

- **混合型插件**：宿主半 `src/index.ts` 负责 `fileUploads` 服务与两条写入路由；浏览器半 `src/client.ts` 负责全部 DOM 交互。
- **浏览器半是纯 DOM 实现**：不 import cordis/dsh 包，不依赖 `ctx` 服务（connection 仅惰性尝试获取，用于评论投递的 legacy 兜底）。**唯一例外**是 tab 菜单条目：惰性 `require('react')`（宿主 shell seed）+ `ctx.get('slots' / 'sidebarRight')` 注册官方席位，任一环节缺席静默退场。
- **交付形态**：npm 包 + dsh bundle。`package.json` 的 `dsh.bundle` / `dsh.client` 字段声明，`cordis.patch.yml` 把插件注册进 Cordis profile 配置树。
- dsh / cordis API 规范以技能文档 `.agents/skills/dsh-plugin-dev/SKILL.md` 为准，**禁止臆造 API**。

## 2. 文件地图

| 文件 | 职责 |
|------|------|
| `src/index.ts` | 宿主端：注册 `FileUploads` 服务、上传路由、删除路由及路径校验 |
| `src/client.ts` | 浏览器端全部逻辑：样式注入、文件树行/头按钮注入、上传/下载/删除、选区工具栏、评论对话框、Composer 投递、右栏 tab 菜单（关闭全部 / 关闭其他） |
| `scripts/wrap-client.mjs` | 给 `lib/client.js` 套 `__ModuleLoader__` 闭包工厂外壳，并剥掉 tsc 追加的 `export {}` |
| `cordis.patch.yml` | profile patch：把 `dsh-file-extra` 注册进配置树 |
| `package.json` | 包声明 + dsh 插件配置；`files` 决定发包内容；`exports["./package.json"]` 必须保留 |
| `tsconfig.json` | `strict` + `noUncheckedIndexedAccess` |
| `vitest.config.ts` | vitest **预留**配置：尚未安装、无 `test/` 目录（见 §7） |
| `lib/` | 构建产物（gitignore），**禁止手改**，只从 `src/` 生成 |
| `README.md` | 用户向文档：功能 / 安装 / 架构 / 锚点 / 调试 / 限制 |
| `AGENTS.md` | 本文件：开发规范、踩坑、调试与扩展入口 |

## 3. 标准命令与验证流程

```bash
npm install
npm run typecheck    # tsc --noEmit（strict 全量检查）
npm run build        # tsc → lib/ + wrap-client.mjs 包装浏览器 bundle
```

- **Windows PowerShell**：若 `npm` 报「npm.ps1 未进行数字签名」，改用 `npm.cmd run build`。
- **每次改动后的验证顺序**：
  1. `npm run typecheck`
  2. `npm run build`（必须执行：浏览器 bundle 由 wrap 重新包装，只 typecheck 不产物流）
  3. 重新安装 / 重载 bundle + DSH **整页刷新（F5）**（原因见踩坑 3）
  4. 按 §5 在 DevTools Console 验证

## 4. 关键约束与踩坑（改动前必读）

1. **`src/client.ts` 禁止 import/export 语句**（末尾 `module.exports = ...` 除外）。构建契约：tsc 只产出纯模块体，`wrap-client.mjs` 再包成 `window.__ModuleLoader__.load({ id, factory })` 闭包工厂。tsc 在 NodeNext 下会给无模块语法的文件追加 `export {}`（会让经典脚本解析报错），wrap 已剥除。浏览器半也不得 import 宿主模块或 `node:*`。
2. **bundle id 必须等于包名**：`scripts/wrap-client.mjs` 里的 `id`、`window.__DSH_BOOT__` 注册 id、`package.json.name` 三者一致（当前均为 `dsh-file-extra`）。改包名时三处同步。
3. **BUILD_GUARD 单例守卫**（`window.__dshFileExtraMounted`）：`apply()` 幂等，同页只挂载一次。**更新代码后必须整页刷新**——仅 HMR 时守卫仍为 true，跑的还是旧代码（典型症状：「改了没生效」）。
4. **绝不手动删除 React 管理的 DOM 节点**。删除文件成功后曾调用 `row.remove()` 移除 `<li>`，随后 React 重渲染卸载该行时抛 `NotFoundError: Failed to execute 'removeChild' ...`（`scoped-slots.tsx` 的错误边界把整个文件树 tab 打崩）。正确做法：只调用 `refreshTree()`（点击 `button[data-files-reload]`）触发文件树 store 重列，由 React 自行移除行。**注入插件只能追加自己的节点，不得删除、替换或移动 React 拥有的节点。**
5. **注入按钮一律追加、可重复执行**：`decorateRows` / `decorateHeader` 以「是否已有本插件按钮」为幂等判据；React 重渲染冲掉按钮后由 MutationObserver 补挂。
6. **行内按钮样式必须 `!important`**：文件行元素自带 CSS Modules 哈希类（如 `.item` 声明 `position`），不加 `!important` 会被覆盖，绝对定位失效。
7. **行内按钮点击必须 `preventDefault` + `stopPropagation`**：行主体是 `<button>`（click 打开文件预览），冒泡会同时触发打开预览。
8. **MutationObserver 安全阀**：连续 300 个变更批次触发 `change storm detected` 并停用观察器（React 高频重排时避免自激）。已有按钮保留可用；正常使用误触发时先排查是否有第三方扩展也在改写 body。
9. **`noUncheckedIndexedAccess`**：一切 `arr[i]` 类型为 `T | undefined`；已按 `.length` 保护的循环内取值用 `arr[i]!`，其余显式判空。
10. **bundle 内禁止把浏览器全局构造函数当自由标识符**（`HTMLLIElement`、`MutationObserver`、`requestAnimationFrame` 等）：bundle 在宿主全局作用域求值，这些名字未必存在，直接引用会抛 `ReferenceError` 并被 init 的 try/catch 吞成「插件静默失效」。一律从 `window` 取并做 `typeof` 兜底（见 `win.MutationObserver` / `nextFrame`）。
11. **下载 URL 是 harness `fileMediaUrl` 的本地复刻**：相对 `api/file?path=`、校验绝对路径、拒绝 UNC 根与控制字符、base 仅限 `http(s)` 与 `dsh-app://app/`。harness 侧规则变化时必须同步（README 锚点表同步）。
12. **上传/删除 URL 用相对路径构造**（`api/dsh-file-extra/...`），以保留部署前缀与桌面 `dsh-app://` scheme。宿主注册的是绝对路由 `/api/dsh-file-extra/...`，前缀剥离由 harness 完成。
13. **HEAD 预检不可达时降级为直接下载**：桌面壳 `dsh-app://` 协议可能拒绝 `fetch`，此时 best-effort anchor 保存。不要改成「预检失败就报错」。
14. **删除的安全边界**：宿主侧要求 `path` 位于 `root` 内、拒绝目录、用 `lstat` + `unlink`（符号链接只删链接本身）。不要改成 `rm -r`，也不要去掉 `root` 约束。
15. **评论区选区判定必须逐级走 `parentNode`**（`closestAcrossShadow`）：文本选区的 `anchorNode` 通常是 Text 节点而非 Element；Shadow DOM 内不能从 ShadowRoot 直接跳 host。禁止把它「简化」回单跳逻辑（历史 bug：`inPreviewArea` 恒 false → 选中无效果）。
16. **Composer 投递链**（`sendToComposer`，每层独立 try/catch、失败自动降级）：
    ① 官方通道：`ctx.get('slots')`（**不能写 `ctx.slots`**——cordis 4 严格访问未声明 inject 的服务属性会抛错）→ 被动注册 `conversation.input.activity` slot 捕获 `props.inputActions`，`captureInsertion()` + `insertText()`；
    ② DOM 兜底：主输入框 contenteditable 派发合成 `ClipboardEvent('paste')`，`execCommand('insertText')` 再兜底；
    ③ `connection.rpc.call('/api', 'conversation/input-paste', ...)`（历史保留，端点未证实）；
    ④ `window.__dshContext` 兜底；
    ⑤ `navigator.clipboard` 最后兜底。
17. **宿主路由必须可逆**：两条路由都用 `ctx.effect(() => ctx.connection.fetch.register(...))` 注册，卸载时自动清理。`inject` 必须含 `connection` 与 `FileUploads` 依赖的 `agents` / `attachments` / `commands`。
18. **旧插件必须卸载**：本插件使用独立 bundle id、单例守卫与路由；旧插件同时启用会造成文件行按钮重复。
19. **发包内容**以 `package.json` `files` 为准（`lib`、`cordis.patch.yml`、`README.md`）；AGENTS.md 仅开发用、不发包。
20. **tab 菜单槽位（`sidebar.right.tab.menu.item`）契约**：
    - 它是 `kind: 'list'` 席位，**register 必须带 `id`**（list 按 id 去重，缺省会让别人的同 id 条目被顶掉；本插件用 `PLUGIN_ID`）。
    - 注册写在 `slots.inject(key, () => slots.register(...))` 回调里——inject 只在席位被宿主声明后才调用，直接 register 会「向未声明席位注册」抛错。
    - 条目组件拿到的 owner props 是**扁平展开**的 `{ tab, dismiss }`，外加会话标准包 `sessionId`；**动作执行前必须先 `dismiss()`**（菜单归 dockkit 所有，只在自身动作上关闭）。
    - 关闭一律走 `sidebarRight.closeIn(sessionId, tabId)`（按会话精确、内部已做 `canCloseTab`：唯一引导页静默跳过 + 关闭清理 handler），会话清单读 `sidebarRight.openTabs.getSnapshot()` 过滤 `sessionId`；服务用 `ctx.get(...)` 惰性取，**不得**写进 `inject`（可选依赖缺席会挡住整个插件加载）。
    - `require('react')` 由 wrap 工厂参数提供，`'react'` 是宿主 shell 的 seed 模块（`packages/client/web/src/seed.ts`）；取不到时功能整体静默退场，不要让它抛穿 init。
    - 条目组件**任何异常都必须吞掉返回 null**：抛错会被错误边界放大，砸掉整个 tab 菜单。

## 5. 调试入口（DevTools Console）

| 日志 / 全局量 | 含义与异常判读 |
|------|------|
| `[dsh-file-extra] plugin loaded: ...` | init 成功。缺失 → bundle 未加载（安装问题），或 init 抛错（查 `window.__dshFileExtraError`） |
| `selection: {...}` | 预览内选区信息；无输出 → 事件未触发（未加载 / iframe）或选区不在预览区 |
| `download refused: <reason> <status> <path>` | 下载预检被拒的原因与状态码 |
| `upload refused: ...` / `delete refused: ...` | 上传 / 删除被服务端拒绝 |
| `sent via ...` / `... failed:` | 评论投递命中的通道或失败原因 |
| `change storm detected` | 观察器安全阀触发，行按钮不再自动补挂 |
| `tab menu slot unavailable: ...` / `tab menu registration failed: ...` | slots 服务缺席或注册失败 → tab 菜单无追加条目（其余功能不受影响） |
| `react unavailable: ...` | 宿主 seed 取不到 react → tab 菜单功能整体退场 |
| `close tab failed: <id> ...` | 单个 tab 关闭异常（其余继续关） |
| `window.__dshFileExtraMounted` | 单例守卫，true 表示已挂载（刷新复位） |
| `window.__dshFileExtraError` | init 抛出的异常字符串 |
| `window.__dshFileExtraConnection` | 惰性缓存的 connection 服务 |

服务端排查：上传/删除失败时直接看宿主日志；路由返回 4xx 时浏览器 toast 会按 `401/403 → 权限`、`404 → 不存在`、`413 → 超限` 分类。

## 6. 开发约定

- **代码与文档同步**：选择器、路由、URL 规则、交互流程变更 → 同步 README.md 与本文件。
- 注释解释「为什么」（契约、坑），不复述代码字面意思。
- `client.ts` 保持自包含：类型用本地 `interface`，不引入外部 d.ts / 第三方库。
- 纯函数优先：DOM 读写集中在 `decorateRows` / `decorateHeader` / `startDownload` / `deleteFile` / `uploadSelected` / `showToast` 等少数函数。
- 新增 UI 文案沿用中文硬编码（与既有风格一致）；需要国际化时按 dsh locale 双字典惯例补 en/zh，不要在 client 里引 locale 服务。
- 不臆造 dsh / cordis API；不确定时查技能文档或 harness 源码（本地 `D:\workspace_node\deepseek-harness`）。

## 7. 已知遗留与扩展入口

| 事项 | 现状 / 入口 |
|------|------|
| 单元测试 | vitest 未安装、无 `test/` 目录。需要时 `npm i -D vitest`，用例放 `test/**/*.test.ts`（`vitest.config.ts` 已配好 include 与 host 绑定） |
| 目录删除 | 未实现。宿主删除路由明确拒绝目录；如要支持，建议单独路由 + 二次确认 + 递归删除上限 |
| 批量选择下载 / 删除 | 未实现；可在行上注入 checkbox 后聚合，注意批量操作的成功/失败汇总 |
| 上传到子目录 | 未实现；上传按钮固定在文件树头部，目标恒为 `[data-files-root]`。可在目录行注入按钮或菜单项，并把该行 `data-files-path` 作为目标 |
| 文案国际化 | 中文硬编码；见 §6 |
| Shadow DOM 文件树 | 未验证。当前行扫描用 `document.querySelectorAll`；若实测文件树进入 shadow root，需改为递归遍历 shadowRoot 注入 |
| 评论 iframe 预览 | 不支持（仅监听主文档 `selectionchange`） |
| 行/列号检测 | 数预览内 `pre code > .line` 的序数（DSH 行号是 CSS counter），失败回退 `data-line`/class 启发式；识别不到只缺行号，不影响发送 |
