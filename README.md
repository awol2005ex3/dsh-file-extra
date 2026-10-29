# dsh-file-extra

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）插件：把 **文件上传 / 下载 / 删除** 与 **预览选区评论** 四类能力整合在同一个插件里。

> 面向后续开发者与 AI Agent 的规范、踩坑与调试入口见 [AGENTS.md](./AGENTS.md)。

## 功能

### 文件树（右侧边栏 Files）

- **上传**：文件树头部刷新按钮左侧新增上传按钮，点击选择（支持多选）后上传到当前文件树根目录，逐个串行上传并汇总结果。
- **下载**：每个文件行 hover 时显示下载按钮；先对 `/api/file` 做 `HEAD` 预检，通过后交给浏览器下载管理器保存。
- **删除**：每个文件行 hover 时显示删除按钮；确认框确认后调用插件自己的删除路由，成功后刷新文件树。

### 文档预览（右侧边栏预览）

- 预览中选中文本后弹出浮动工具栏：
  - **评论并提问**：输入评论，与「文件路径 + 行列范围 + 代码块」一起格式化发送到会话输入框
  - **发送到聊天**：直接发送选中内容
- 投递到输入框采用分层回退，命中顺序见 [AGENTS.md](./AGENTS.md) 的「Composer 投递链」。

## 安装

本插件替代此前的 `dsh-file-comment`、`dsh-file-download`、`dsh-file-upload` 三个独立插件。

> **先卸载旧插件**：旧插件若仍启用，文件行会出现重复按钮（`dsh-file-extra` 使用自己的 bundle id 与单例守卫，不会互相顶掉）。

```bash
npx @deepseek-ai/dsh plugin --profile web add D:/path/to/dsh-file-extra
```

安装后需要**重启宿主**（插件集在启动时扫描并缓存），浏览器端**整页刷新（F5）**。

验证装配：

- `npx @deepseek-ai/dsh --profile web --dump-config` 能看到 `dsh-file-extra` 行
- DevTools 中 `window.__DSH_BOOT__.entries` 含 `dsh-file-extra`，`/plugins/dsh-file-extra/client.js` 返回 200

## 构建

```bash
npm install
npm run typecheck   # tsc --noEmit（strict + noUncheckedIndexedAccess）
npm run build       # tsc 编译到 lib/ + wrap-client.mjs 包装浏览器 bundle
```

> Windows PowerShell 提示 `npm.ps1` 未进行数字签名时，改用 `npm.cmd run build`。

## 架构

```
dsh-file-extra/
├── package.json          # 包声明 + dsh.bundle / dsh.client 配置
├── cordis.patch.yml      # Cordis profile patch（注册插件到配置树）
├── tsconfig.json         # strict + noUncheckedIndexedAccess
├── vitest.config.ts      # vitest 预留配置（尚未安装，见 AGENTS.md）
├── scripts/
│   └── wrap-client.mjs   # 浏览器 bundle 闭包工厂包装脚本
├── lib/                  # 构建产物（gitignore，勿手改）
└── src/
    ├── index.ts          # 宿主端：fileUploads 服务 + 上传/删除两条精确路由
    └── client.ts         # 浏览器端全部逻辑：文件树按钮注入、上传/下载/删除、
                          # 选区工具栏、评论对话框、Composer 投递
```

### 宿主半（Node）

- 注册 `@deepseek-ai/dsh-client-file-upload` 提供的 `fileUploads` 服务（Session controller 依赖它）。
- 用 `ctx.connection.fetch.register()` 注册两条精确路由（官方 `/api/file` 只有 `GET/HEAD`，写入与删除必须自建路由）。

| 路由 | 方法 | 参数 | 行为 |
|------|------|------|------|
| `/api/dsh-file-extra/upload` | POST | `path`（目标目录，绝对路径）、`name`（单段文件名） | 请求体原始字节写入 `<path>/<name>` |
| `/api/dsh-file-extra/delete` | POST | `path`（目标文件，绝对路径）、`root`（文件树根目录，绝对路径） | 删除单个普通文件或符号链接 |

路由鉴权由 connection 服务完成（仅所有者端可达），路径校验在宿主侧：

- 两者都要求绝对路径、拒绝 `\0`
- 上传文件名必须是单段（拒绝 `/`、`\`、`.`、`..`）
- 删除额外要求 `path` 位于 `root` 之内；`lstat` 后仅接受普通文件与符号链接（**目录一律拒绝**），`unlink` 不会跟随符号链接删除其目标

### 浏览器半

纯 DOM 实现，不 import cordis/dsh 包；只依赖公开 DOM 锚点与 HTTP 路由两个稳定面：

| 能力 | 触发方式 | 实现要点 |
|------|----------|----------|
| 上传 | 头部注入按钮 | 文件树根目录取 `[data-files-root]`；多文件串行 POST |
| 下载 | 行内注入按钮 | `HEAD` 预检（拒绝时 toast 原因）；预检通道不可达则直接 anchor 下载 |
| 删除 | 行内注入按钮 | 确认框（默认聚焦“取消”）；成功后只刷新文件树，**不手动删 React 节点** |
| 评论 | `selectionchange` | 选区必须落在预览区；格式化后分层投递给输入框 |

## 关键 DOM 锚点

| 选择器 | 用途 |
|--------|------|
| `li[data-files-entry="file"]` | 文件行（下载/删除按钮挂载点） |
| `li[data-files-path]` | 行的绝对路径 |
| `[data-files-root]` | 文件树根目录（上传目标 / 删除根约束） |
| `button[data-files-reload]` | 刷新按钮（上传/删除成功后以它的 click 触发重列） |
| `[data-code-preview]` | 代码预览容器 |
| `[data-textpreview-url]` / `[data-textpreview-path]` | 文档预览根节点 / 头部路径标签 |
| `pre code > .line` | 代码行（行号是 CSS counter，不在 DOM 里，行号 = 序数） |
| `[data-sidebar-right-session]`、`[data-slot="sidebar.right.pane.tab"]` | 右侧边栏容器 / tab |

以上选择器定义于 `src/client.ts` 顶部与评论区 `PREVIEW_SELECTORS`。

## 调试（DevTools Console）

| 日志 / 全局量 | 含义 |
|------|------|
| `[dsh-file-extra] plugin loaded: ...` | init 成功；缺失 → 未加载或 init 抛错（查 `window.__dshFileExtraError`） |
| `selection: {...}` | 预览内选区信息（长度 / 路径 / 起始行） |
| `download refused: <reason> <status> <path>` | 下载预检被拒 |
| `upload refused: ...` / `delete refused: ...` | 上传 / 删除被服务端拒绝 |
| `sent via ...` | 评论投递命中的通道 |
| `change storm detected` | MutationObserver 安全阀触发，观察器停用 |
| `__dshFileExtraMounted` | 单例守卫；true 表示当前页已挂载（刷新复位） |
| `__dshFileExtraConnection` | 缓存的 connection 服务（评论投递 legacy 层使用） |

## 已知限制

- 删除只针对**文件**（含符号链接），目录不提供删除（避免误删整棵子树）。
- 上传目标是**文件树根目录**，不支持上传到任意子目录。
- 评论仅监听主文档的 `selectionchange`，预览内容位于 iframe 时不支持。
- 文件树若被渲染进 Shadow DOM，行按钮注入不会生效（当前按主文档查询）。
- 文案为中文硬编码，未接入 dsh locale 服务。

## License

Apache License 2.0
