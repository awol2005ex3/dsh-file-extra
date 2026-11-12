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
| — | 终端（xterm.js）选区引入对话框 | 本插件新增（与预览选区共用工具栏与投递链） |
| — | 文件行右键菜单：添加到对话 @文件 | 本插件新增（`contextMenus` 数据动作 + 会话作用域 `slash/input-insert-reference` 事件） |

- **混合型插件**：宿主半 `src/index.ts` 负责 `fileUploads` 服务与两条写入路由；浏览器半 `src/client.ts` 负责全部 DOM 交互。
- **浏览器半以 DOM 交互为主**：不 import cordis/dsh 包；宿主服务经 `ctx.get(...)` 惰性获取。React 接触点仅有 tab 菜单和输入框捕获组件，均惰性 `require('react')`；后者占用 `conversation.input.left` 列表槽位，layout effect 按会话缓存 InputActions，卸载时清理。文件菜单本身走 `contextMenus` 数据动作，插入走 `sessions.scope` 事件。
- **交付形态**：npm 包 + dsh bundle。`package.json` 的 `dsh.bundle` / `dsh.client` 字段声明，`cordis.patch.yml` 把插件注册进 Cordis profile 配置树。
- dsh / cordis API 规范以技能文档 `.agents/skills/dsh-plugin-dev/SKILL.md` 为准，**禁止臆造 API**。

## 2. 文件地图

| 文件 | 职责 |
|------|------|
| `src/index.ts` | 宿主端：注册 `FileUploads` 服务、上传路由、删除路由及路径校验 |
| `src/client.ts` | 浏览器端全部逻辑：样式注入、文件树行/头按钮注入、上传/下载/删除、选区工具栏（预览 + 终端）、评论对话框、Composer 投递、右栏 tab 菜单（关闭全部 / 关闭其他）、文件 @引用菜单（添加到对话） |
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
    ① 官方通道：`ctx.get('slots')`（**不能写 `ctx.slots`**——cordis 4 严格访问未声明 inject 的服务属性会抛错）→ 在 `conversation.input.left`（list / session）注册带唯一 id 的空组件，通过 React layout effect 捕获 `props.inputActions`，卸载时清理；`captureInsertion()` + `insertText()`；
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
21. **终端选区（xterm.js）读文本只能走 copy 事件**：侧边栏终端是 `@xterm/xterm` 模拟器，屏幕由内部缓冲区绘制、根元素 `.xterm` 自带 `user-select:none`，所以 `window.getSelection()` 永远读不到终端文字，`selectionchange` 也不会因终端拖选而触发。实现方式是对 `div.xterm` 派发一个合成的 `ClipboardEvent('copy')`，用 `DataTransfer` 接住 xterm 自己 `copy` 监听写入的 `selectionText`——不触碰系统剪贴板，也不依赖具体渲染器。
    - 归属判定：`mousedown` 落在 `.xterm` 上才记录 `activeTerminal`；任何落在终端与工具栏之外的按下都会清空它（否则焦点移到输入框后会被旧选区重新拉起工具栏）。
    - 刷新时机：`mouseup`（拖选）、`dblclick`（双击选词）、`keyup`（Shift+方向键）后各补一次读取；都延到下一帧/宏任务，等 xterm 自己的监听跑完。
    - 终端面板锚点是 `section[data-sidebar-terminal]`（`ui-sidebar-terminal` 的宿主元素）；tab 标题取 `span[data-sidebar-right-tab]` 的文本，closest 找不到时再扫 shadow root（结果缓存）。
    - 终端输出没有文件路径与行列号，投递时以「📟 `<tab 标题>` — 终端输出」作头部；超过 `MAX_TERMINAL_CHARS`（20000 字符）截断并标注。
22. **文件 @引用菜单（`contextMenus` 数据动作 + 会话作用域事件）契约**：
    - 文件行右键菜单由宿主 `contextMenus` 服务装配（`ui-context-menu`），**不是 slot**。用 `ctx.get('contextMenus').register({ id: PLUGIN_ID, target: 'file', order: 300, resolve })` 追加数据动作；内置 open-in-app / file-actions 是 order 100/200，300 + `separatorBefore: true` 排在宿主条目之后。`resolve(target)` 返回 `MenuAction[]`（`{ id, label, separatorBefore, run }`），`run` 里执行插入。注册经 `ctx.effect` 包裹保证可逆；`contextMenus` 可能晚于 apply 就绪，apply 与首次 `contextmenu`（capture）各补试一次（`ensureFileMenu` 幂等）。
    - target value 是 `{ sessionId, path }`，**path 恒为绝对路径**（`ui-sidebar-files` store 契约）。投递前用本地复刻的 `relativizeToCwd`（剥会话 cwd 根前缀、保留原分隔符）+ `formatFileMentionText`（`@deepseek-ai/dsh-file-reference/grammar` 的 file 分支：控制字符 / 引号 → 不可表示，含空格 → `@"…"`）生成 mention；cwd 读 `sessions.list.getSnapshot().byId[sessionId]?.cwd`。不可表示的路径在 `resolve` 里就不返回条目。
    - **插 chip 的唯一官方路径是会话作用域 bail 事件**：`const actx = sessions.scope(sessionId)`（返回 `AgentContext | undefined`，**不是** handle），再 `actx.bail(actx, 'slash/input-insert-reference', { reference, span }) === true`。thisArg 必须是 scope 出来的 actx——根 ctx 派发会被 `[Context.filter]` 挡在会话 shell 之外。`reference` 形如 `{ source: 'reference', ref: mention, label: basename, appearance: 'file', clipboardText: mention }`（与 `ui-reference` onPick / `ui-conversation` apply.ts addFiles 一致）；`span` 来自该会话 InputActions 的 `captureInsertion()`，shell 侧有 phase（plain/claimed）+ `draftRev` CAS 守卫。
    - **InputActions 按已挂载会话捕获**：使用 `conversation.input.left`（list / session）+ 唯一 id `dsh-file-extra/composer-capture`，空组件经 React `useLayoutEffect` 保存 `props.sessionId` / `props.inputActions`，卸载或 props 改变时清理旧引用。**不能占用 `conversation.input.activity`**：它是 single，同优先级冲突会抛错，其他优先级只渲染赢家，返回 null 也不会自动让出给其他插件。
    - 文件引用只走目标会话的 scoped bail 事件，未接受时用同一 span 尝试 `actions.insertText(mention + ' ', span)`（纯 @token）。未捕获或编辑器锁定时提示重试；**禁止退回 DOM 粘贴或系统剪贴板**，禁止自动 submit，不能把复制成功当成插入成功。预览/终端评论的原有降级链不变。
    - `contextMenus` / `sessions` 都用 `ctx.get(...)` 惰性取，**不得**写进顶层 `inject`。`contextMenus` 缺席不注册菜单；`sessions` 缺席时仍可经已捕获的 InputActions 直接插入文本，其余功能不受影响。

## 5. 调试入口（DevTools Console）

| 日志 / 全局量 | 含义与异常判读 |
|------|------|
| `[dsh-file-extra] plugin loaded: ...` | init 成功。缺失 → bundle 未加载（安装问题），或 init 抛错（查 `window.__dshFileExtraError`） |
| `selection: {...}` | 预览内选区信息；无输出 → 事件未触发（未加载 / iframe）或选区不在预览区 |
| `terminal selection: {len, tab}` | 终端选区命中；`len` 为 0 或缺失 → xterm 无选区 / copy 事件未被接住（查 `ClipboardEvent` / `DataTransfer` 是否可用） |
| `download refused: <reason> <status> <path>` | 下载预检被拒的原因与状态码 |
| `upload refused: ...` / `delete refused: ...` | 上传 / 删除被服务端拒绝 |
| `sent via ...` / `... failed:` | 评论投递命中的通道或失败原因 |
| `change storm detected` | 观察器安全阀触发，行按钮不再自动补挂 |
| `tab menu slot unavailable: ...` / `tab menu registration failed: ...` | slots 服务缺席或注册失败 → tab 菜单无追加条目（其余功能不受影响） |
| `react unavailable: ...` | 宿主 seed 取不到 react → tab 菜单功能整体退场 |
| `close tab failed: <id> ...` | 单个 tab 关闭异常（其余继续关） |
| `file menu unavailable: ...` | 文件菜单注册异常（contextMenus 缺席时静默跳过） |
| `composer capture unavailable: ...` / `composer not captured: <sessionId>` | 输入框槽位注册失败 / 目标会话输入框尚未挂载 |
| `reference via ...` | @引用直接插入命中的通道（scoped insert-reference / insertText） |
| `insert-reference failed: ...` | 插入异常，显示重试提示，不写剪贴板 |
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
| 终端选区 | 依赖 xterm 的 `copy` 事件契约（xterm 6.x 公开行为）。若 `DataTransfer` / `ClipboardEvent` 构造器缺失，终端选区静默失效；终端里**由 shell 自己处理鼠标**的模式（如全屏 TUI 开启 mouse reporting）下拖选会被程序吃掉，属终端行为，不另行处理 |
| 行/列号检测 | 数预览内 `pre code > .line` 的序数（DSH 行号是 CSS counter），失败回退 `data-line`/class 启发式；识别不到只缺行号，不影响发送 |
