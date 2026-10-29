/**
 * dsh-file-extra — Browser bundle module body.
 *
 * Build contract (deepseek-harness packages/client/tsdown.client.ts closure
 * factory format): this file is compiled by tsc, then wrapped by
 * scripts/wrap-client.mjs with:
 *   banner: window.__ModuleLoader__.load({ id, factory: (require) => {
 *   intro : var module = { exports: {} }; var exports = module.exports;
 *   footer: return module.exports; } });
 * becoming a lazy CJS bundle. Side effects run inside the factory closure
 * when the browser shell materializes the fiber.
 *
 * No import/export statements (except the final module.exports assignment)
 * so the wrap script can cleanly enclose the body. Types are declared
 * locally to avoid external d.ts imports.
 *
 * Features (formerly three separate plugins):
 *   1. File-tree rows: hover-revealed download button (HEAD preflight against
 *      the authenticated /api/file route, then an anchor save).
 *   2. File-tree rows: hover-revealed delete button (confirm dialog, then
 *      POST /api/dsh-file-extra/delete; files only, never directories).
 *   3. File-tree header: upload button left of the reload button (POST raw
 *      bytes to /api/dsh-file-extra/upload for the tree root).
 *   4. Document preview: text selection toolbar → comment dialog → formatted
 *      text delivered to the conversation composer.
 */

const PLUGIN_ID = 'dsh-file-extra'

/* ── Build guard (single mount) ── */
const GUARD_KEY = '__dshFileExtraMounted'

/* ── CJS globals injected by the wrap script ── */
declare const module: { exports: unknown }

/* ── Narrow DOM access ── */
const win = window as unknown as Record<string, unknown>
const globals = window as unknown as Record<string, any>
const doc = document

/** 计时器窗口面：避开 NodeNext 下全局 setTimeout 的 Node 返回类型歧义。 */
interface TimerWindow {
  setTimeout(handler: () => void, timeout: number): number
  clearTimeout(id: number | undefined): void
}
const timers = win as unknown as TimerWindow

/** 观察器构造器面：bundle 在全局作用域求值，构造函数一律从 window 取。 */
type MutationObserverCtor = new (cb: () => void) => { observe(target: Element, opts: Record<string, boolean>): void; disconnect(): void }
const MutationObserverCtor = (win as unknown as { MutationObserver?: MutationObserverCtor }).MutationObserver

/** 帧调度：优先 requestAnimationFrame，缺失环境退回短延时定时器。 */
function nextFrame(cb: () => void): void {
  const raf = (win as unknown as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame
  if (typeof raf === 'function') raf(cb)
  else timers.setTimeout(cb, 16)
}

/* ── DOM anchors ── */
const FILE_ROW_SELECTOR = 'li[data-files-entry="file"]'
const RELOAD_SELECTOR = 'button[data-files-reload]'
const ROOT_SELECTOR = '[data-files-root]'

/* ── DOM ids / classes owned by this plugin ── */
const STYLE_ID = PLUGIN_ID + '-style'
const TOAST_ID = PLUGIN_ID + '-toast'
const CONFIRM_ID = PLUGIN_ID + '-confirm'
const TOOLBAR_ID = PLUGIN_ID + '-toolbar'
const DIALOG_ID = PLUGIN_ID + '-dialog'
const FILE_INPUT_ID = PLUGIN_ID + '-file-input'
const HOST_CLASS = 'dsh-fe-host'
const ACTIONS_CLASS = 'dsh-fe-actions'
const BTN_CLASS = 'dsh-fe-btn'
const DANGER_CLASS = 'dsh-fe-btn--danger'
const UP_BTN_CLASS = 'dsh-fe-up-btn'

/* ── Host routes (registered by src/index.ts) ── */
const UPLOAD_ROUTE = 'api/dsh-file-extra/upload'
const DELETE_ROUTE = 'api/dsh-file-extra/delete'

/* ── Copy (plugin-local, no locale service) ── */
const DL_LABEL = '下载此文件'
const DL_BUSY_LABEL = '正在准备下载…'
const DEL_LABEL = '删除此文件'
const DEL_BUSY_LABEL = '正在删除…'
const UP_LABEL = '上传文件'
const UP_BUSY_LABEL = '正在上传…'

const DOWNLOAD_FAILURE: Record<string, string> = {
  notFound: '文件不存在或已被删除',
  denied: '没有读取该文件的权限',
  tooLarge: '文件超过服务端下载大小上限',
  unavailable: '暂时无法下载该文件',
}

const DELETE_FAILURE: Record<string, string> = {
  notFound: '文件不存在或已被删除',
  denied: '没有删除该文件的权限',
  tooLarge: '文件过大，无法删除',
  unavailable: '暂时无法删除该文件',
}

const UPLOAD_FAILURE: Record<string, string> = {
  notFound: '目标目录不存在或已被删除',
  denied: '没有向该目录上传文件的权限',
  tooLarge: '上传文件超过服务端大小上限',
  unavailable: '暂时无法上传文件',
}

/* 图标 stroke 用 currentColor，跟随行文字色与主题。 */
const ICON_DOWNLOAD =
  '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
  'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M10 3.5v7.5"/><path d="M6.4 8l3.6 3.5L13.6 8"/><path d="M4.8 15.2h10.4"/></svg>'

const ICON_TRASH =
  '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
  'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 6h12"/><path d="M8 3.5h4"/>' +
  '<path d="M6.2 6l.7 9.2c.04.5.46.8.95.8h4.3c.49 0 .91-.3.95-.8L13.8 6"/>' +
  '<path d="M8.6 9v4.4"/><path d="M11.4 9v4.4"/></svg>'

const ICON_UPLOAD =
  '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
  'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M10 14V4"/><path d="M6 7.5L10 3.5l4 4"/><path d="M4 16h12"/></svg>'

/* ──────────────────────────────────────────────────────────
 * Shared helpers
 * ────────────────────────────────────────────────────────── */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Record<string, unknown>,
  children?: (Node | string)[],
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag)
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === 'style') node.setAttribute('style', v as string)
      else (node as unknown as Record<string, unknown>)[k] = v
    }
  }
  if (children) {
    for (const c of children) node.append(typeof c === 'string' ? doc.createTextNode(c) : c)
  }
  return node
}

/**
 * Like `Element.closest`, but crosses Shadow DOM boundaries (DSH uses
 * Shadow DOM extensively): walks up the parent chain one level at a time and
 * only hops from a ShadowRoot to its host when the tree edge is reached.
 * Accepts any node — text-node anchors (the normal case for text selections)
 * are handled by walking up to their parent element first.
 */
function closestAcrossShadow(node: Node | null, selector: string): Element | null {
  let current: Node | null = node
  while (current) {
    if (current instanceof Element) {
      const hit = current.closest(selector)
      if (hit) return hit
    }
    const parent = current.parentNode
    if (parent) {
      current = parent
      continue
    }
    /* tree edge: hop across the Shadow DOM boundary if there is one */
    const root = current.getRootNode()
    if (root instanceof ShadowRoot) {
      current = root.host
      continue
    }
    break
  }
  return null
}

/** Absolute workspace path: POSIX leading `/`, or a Windows drive form. */
function isAbsoluteWorkspacePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:[/\\]/u.test(path)
}

/** Basename of a workspace path, in either slash direction. */
function basenameOf(path: string): string {
  const parts = path.split(/[/\\]/u)
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]
    if (part !== undefined && part !== '') return part
  }
  return path
}

/**
 * Build a same-origin URL for an API route relative to the document base,
 * mirroring `util/workspace-path`'s `fileMediaUrl` convention so deployment
 * prefixes and the desktop `dsh-app://app/` scheme are preserved.
 */
function routeUrl(route: string, params?: Record<string, string>): string | undefined {
  const base = doc.baseURI
  if (!/^https?:/u.test(base) && !base.startsWith('dsh-app://app/')) return undefined
  try {
    const query = params === undefined ? '' : '?' + new URLSearchParams(params).toString()
    return new URL(route + query, base).href
  } catch {
    return undefined
  }
}

/** Classify a route refusal; an unlisted status is unavailability. */
function classifyFailure(status: number): string {
  if (status === 401 || status === 403) return 'denied'
  if (status === 404) return 'notFound'
  if (status === 413) return 'tooLarge'
  return 'unavailable'
}

let toastTimer: number | undefined

function showToast(message: string): void {
  let toast = doc.getElementById(TOAST_ID)
  if (toast === null) {
    toast = doc.createElement('div')
    toast.id = TOAST_ID
    doc.body.append(toast)
  }
  toast.textContent = message
  timers.clearTimeout(toastTimer)
  toastTimer = timers.setTimeout(() => {
    const stale = doc.getElementById(TOAST_ID)
    if (stale !== null) stale.remove()
  }, 2600)
}

/** Ask the file tree to re-list the current root (the reload button owns that). */
function refreshTree(): void {
  const reload = doc.querySelector(RELOAD_SELECTOR)
  if (reload instanceof HTMLElement) reload.click()
}

/* ──────────────────────────────────────────────────────────
 * Styles
 * ────────────────────────────────────────────────────────── */

const STYLE_CSS = [
  /* 行元素自带 CSS Modules 样式（如 .item 的 position），注入规则一律 !important 兜底 */
  '.dsh-fe-host { position: relative !important; }',
  '.dsh-fe-actions {' +
  ' position: absolute !important; right: 6px !important; top: 3px !important;' +
  ' display: inline-flex !important; align-items: center; gap: 2px;' +
  ' opacity: 0; pointer-events: none; transition: opacity .12s ease; z-index: 1;' +
  ' }',
  /* hover / 键盘聚焦时才出现，避免常驻图标干扰阅读 */
  '.dsh-fe-host:hover .dsh-fe-actions, .dsh-fe-actions:focus-within {' +
  ' opacity: .9 !important; pointer-events: auto !important; }',
  '.dsh-fe-btn {' +
  ' display: inline-flex !important; align-items: center; justify-content: center;' +
  ' width: 22px !important; height: 22px !important; padding: 0; border-radius: 5px;' +
  ' border: 1px solid rgba(128, 128, 128, 0.35); background: transparent; color: inherit;' +
  ' cursor: pointer; opacity: .85; transition: opacity .12s ease, background .12s ease;' +
  ' }',
  '.dsh-fe-btn:hover { opacity: 1 !important; background: rgba(128, 128, 128, 0.16); }',
  '.dsh-fe-btn:disabled { cursor: default; }',
  '.dsh-fe-btn[data-busy="1"] { opacity: 1 !important; animation: dsh-fe-pulse 0.9s ease-in-out infinite; }',
  '.dsh-fe-btn--danger:hover {' +
  ' color: #f38ba8; border-color: rgba(243, 139, 168, 0.6); background: rgba(243, 139, 168, 0.12); }',
  '.dsh-fe-up-btn { flex: none; margin-right: 4px; }',
  '@keyframes dsh-fe-pulse { 50% { opacity: 0.35; } }',
  '#' + TOAST_ID + ' {' +
  ' position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);' +
  ' padding: 7px 14px; border-radius: 8px; background: rgba(30, 30, 46, 0.95);' +
  ' color: #cdd6f4; font: 12px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;' +
  ' border: 1px solid rgba(205, 214, 244, 0.2); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);' +
  ' z-index: 2147483646; max-width: 70vw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' +
  ' }',
].join('\n')

function installStyle(): void {
  if (doc.getElementById(STYLE_ID) !== null) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE_CSS
  ;(doc.head ?? doc.body).append(style)
}

/* ── Shared dialog / button styles (comment toolbar & delete confirm) ── */

const BTN_CSS = [
  'padding:4px 10px;cursor:pointer;',
  'border:1px solid rgba(205,214,244,.25);background:transparent;color:#cdd6f4;',
  'border-radius:5px;font:12px/1.4 inherit;white-space:nowrap;',
].join('')

const BTN_PRI_CSS = 'background:#89b4fa;color:#1e1e2e;border-color:#89b4fa;'
const BTN_DANGER_CSS = 'background:#f38ba8;color:#1e1e2e;border-color:#f38ba8;'
const CLOSE_BTN_CSS = 'background:none;border:none;color:#cdd6f4;cursor:pointer;font-size:18px;padding:0 4px;'
const META_CSS = 'opacity:.65;font-size:12px;margin-bottom:10px;'

const DIALOG_OV_CSS = [
  'position:fixed;inset:0;z-index:2147483647;',
  'display:flex;align-items:center;justify-content:center;',
  'background:rgba(0,0,0,.45);',
].join('')

const DIALOG_BOX_CSS = [
  'width:480px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;',
  'background:#1e1e2e;color:#cdd6f4;border-radius:12px;',
  'box-shadow:0 12px 40px rgba(0,0,0,.45);overflow:hidden;',
  'font:14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;',
].join('')

const DIALOG_HDR_CSS = 'display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid rgba(205,214,244,.12);'
const DIALOG_BODY_CSS = 'flex:1;overflow:auto;padding:16px;'
const DIALOG_FTR_CSS = 'display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid rgba(205,214,244,.12);'

/* ──────────────────────────────────────────────────────────
 * File tree — download
 * ────────────────────────────────────────────────────────── */

/** Build the authenticated /api/file URL for one absolute path. */
function fileDownloadUrl(path: string): string | undefined {
  if (
    !isAbsoluteWorkspacePath(path)
    || /^[/\\]{2}/u.test(path)
    || /[\u0000-\u001f\u007f]/u.test(path)
  ) return undefined
  return routeUrl('api/file', { path })
}

/** Click a same-origin anchor at the file route, naming the saved file. */
function triggerSave(url: string, name: string): void {
  const anchor = doc.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.rel = 'noopener'
  anchor.click()
}

/**
 * One save attempt: preflight, then hand the route to the browser.
 *
 * The HEAD is what makes a refusal visible: without it the reader saves a
 * file holding the route's error text. When the HEAD itself cannot reach the
 * route (a custom protocol that fetch refuses, e.g. the desktop dsh-app://
 * shell), fall back to the direct anchor save rather than reporting nothing.
 */
function startDownload(li: Element, btn: HTMLButtonElement): void {
  if (btn.disabled) return
  const path = li.getAttribute('data-files-path')
  const unavailable = DOWNLOAD_FAILURE['unavailable'] ?? '无法下载'
  if (path === null || path === '') {
    showToast(unavailable)
    return
  }
  const url = fileDownloadUrl(path)
  if (url === undefined) {
    showToast(unavailable)
    return
  }
  const name = basenameOf(path)
  btn.disabled = true
  btn.setAttribute('data-busy', '1')
  btn.setAttribute('aria-label', DL_BUSY_LABEL)

  const finish = (): void => {
    btn.disabled = false
    btn.removeAttribute('data-busy')
    btn.setAttribute('aria-label', DL_LABEL)
  }

  fetch(url, { method: 'HEAD' })
    .then((response) => {
      if (response.ok) {
        triggerSave(url, name)
      } else {
        const reason = classifyFailure(response.status)
        showToast(DOWNLOAD_FAILURE[reason] ?? unavailable)
        console.debug('[dsh-file-extra] download refused:', reason, response.status, path)
      }
    })
    .catch(() => {
      /* 预检通道不可达（如自定义协议拒绝 fetch）：best-effort 直接下载 */
      triggerSave(url, name)
    })
    .finally(finish)
}

/* ──────────────────────────────────────────────────────────
 * File tree — delete
 * ────────────────────────────────────────────────────────── */

function hideDeleteConfirm(): void {
  const existing = doc.getElementById(CONFIRM_ID)
  if (existing !== null) existing.remove()
}

/** 该行所属文件树的根目录：优先取行祖先上的 data-files-root，再退回全局查询。 */
function treeRootFor(row: Element): string | null {
  const tree = row.closest(ROOT_SELECTOR)
  const value = tree?.getAttribute('data-files-root')
  if (value !== null && value !== undefined && value !== '') return value
  return currentRoot()
}

function showDeleteConfirm(path: string, root: string, btn: HTMLButtonElement): void {
  hideDeleteConfirm()

  const overlay = el('div', { id: CONFIRM_ID, style: DIALOG_OV_CSS })

  const closeBtn = el('button', { style: CLOSE_BTN_CSS, textContent: '\u00D7' })
  closeBtn.addEventListener('click', hideDeleteConfirm)
  const header = el('div', { style: DIALOG_HDR_CSS }, [
    el('div', { style: 'font-weight:700;font-size:15px;', textContent: '\u{1F5D1} 删除文件' }),
    closeBtn,
  ])

  const meta = el('div', { style: META_CSS })
  meta.textContent = path
  const warning = el('p', { style: 'margin:10px 0 0;' })
  warning.textContent = '将永久删除“' + basenameOf(path) + '”，此操作无法撤销。'

  const body = el('div', { style: DIALOG_BODY_CSS }, [meta, warning])

  const cancelBtn = el('button', { style: BTN_CSS, textContent: '取消' })
  cancelBtn.addEventListener('click', hideDeleteConfirm)
  const confirmBtn = el('button', { style: BTN_CSS + BTN_DANGER_CSS, textContent: '删除' })
  confirmBtn.addEventListener('click', () => {
    hideDeleteConfirm()
    deleteFile(path, root, btn)
  })

  const footer = el('div', { style: DIALOG_FTR_CSS }, [cancelBtn, confirmBtn])
  const box = el('div', { style: DIALOG_BOX_CSS }, [header, body, footer])
  overlay.append(box)
  overlay.addEventListener('click', (event) => { if (event.target === overlay) hideDeleteConfirm() })
  overlay.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape') hideDeleteConfirm()
  })
  doc.body.append(overlay)
  /* 危险操作默认聚焦“取消”，Enter 不会误删 */
  cancelBtn.focus()
}

function deleteFile(path: string, root: string, btn: HTMLButtonElement): void {
  if (btn.disabled) return
  const url = routeUrl(DELETE_ROUTE, { path, root })
  if (url === undefined) {
    showToast('无法定位删除接口')
    return
  }
  btn.disabled = true
  btn.setAttribute('data-busy', '1')
  btn.setAttribute('aria-label', DEL_BUSY_LABEL)

  const finish = (): void => {
    btn.disabled = false
    btn.removeAttribute('data-busy')
    btn.setAttribute('aria-label', DEL_LABEL)
  }

  fetch(url, { method: 'POST', credentials: 'same-origin' })
    .then((response) => {
      if (response.ok) {
        showToast('已删除 ' + basenameOf(path))
        /* 行是 React 管理的节点：绝不能手动 remove()，否则 React 之后
         * 卸载该节点时 removeChild 会抛 NotFoundError。交给刷新重列。 */
        refreshTree()
      } else {
        const reason = classifyFailure(response.status)
        showToast(DELETE_FAILURE[reason] ?? DELETE_FAILURE['unavailable'] ?? '删除失败')
        console.debug('[dsh-file-extra] delete refused:', reason, response.status, path)
      }
    })
    .catch(() => {
      showToast('删除失败：无法连接到服务端')
    })
    .finally(finish)
}

/* ──────────────────────────────────────────────────────────
 * File tree — upload (header button)
 * ────────────────────────────────────────────────────────── */

/** 全局隐藏的文件选择输入：点击头部上传按钮后弹出选择框，选中的文件上传到文件树根目录。 */
let fileInput: HTMLInputElement | null = null

function ensureFileInput(): HTMLInputElement {
  if (fileInput !== null) return fileInput
  const input = doc.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.style.display = 'none'
  input.id = FILE_INPUT_ID
  doc.body.appendChild(input)
  fileInput = input
  return input
}

/** 读取文件树当前根目录（data-files-root 所在容器的属性）。 */
function currentRoot(): string | null {
  const rootEl = doc.querySelector(ROOT_SELECTOR)
  if (rootEl === null) return null
  return rootEl.getAttribute('data-files-root')
}

function setUploadBusy(btn: HTMLButtonElement, busy: boolean): void {
  if (busy) {
    btn.disabled = true
    btn.setAttribute('data-busy', '1')
    btn.setAttribute('aria-label', UP_BUSY_LABEL)
    btn.title = UP_BUSY_LABEL
  } else {
    btn.disabled = false
    btn.removeAttribute('data-busy')
    btn.setAttribute('aria-label', UP_LABEL)
    btn.title = UP_LABEL
  }
}

async function uploadOne(root: string, file: File): Promise<boolean> {
  // 官方 /api/file 只有 GET/HEAD，上传走插件自己注册的 POST 路由。
  const url = routeUrl(UPLOAD_ROUTE, { path: root, name: file.name })
  if (url === undefined) {
    showToast('无法定位上传接口')
    return false
  }
  try {
    const response = await fetch(url, { method: 'POST', body: file, credentials: 'same-origin' })
    if (response.ok) return true
    const reason = classifyFailure(response.status)
    showToast(UPLOAD_FAILURE[reason] ?? UPLOAD_FAILURE['unavailable'] ?? '上传失败')
    console.debug('[dsh-file-extra] upload refused:', reason, response.status, root, file.name)
    return false
  } catch {
    showToast('上传失败：无法连接到服务端')
    return false
  }
}

async function uploadSelected(root: string, files: FileList, btn: HTMLButtonElement): Promise<void> {
  setUploadBusy(btn, true)
  let uploaded = 0
  let failed = 0
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files.item(i)
      if (file === null) continue
      if (await uploadOne(root, file)) uploaded++
      else failed++
    }
    if (failed === 0) showToast(`已上传 ${uploaded} 个文件`)
    else showToast(`${failed} 个文件上传失败，${uploaded} 个成功`)
    if (uploaded > 0) refreshTree()
  } finally {
    setUploadBusy(btn, false)
  }
}

function uploadFiles(root: string, btn: HTMLButtonElement): void {
  const input = ensureFileInput()
  input.value = ''
  input.onchange = () => {
    const files = input.files
    if (files === null || files.length === 0) return
    void uploadSelected(root, files, btn)
  }
  input.click()
}

/* ──────────────────────────────────────────────────────────
 * File tree — decoration & observation
 * ────────────────────────────────────────────────────────── */

function iconButton(label: string, svg: string, extraClass?: string): HTMLButtonElement {
  const btn = doc.createElement('button')
  btn.type = 'button'
  btn.className = BTN_CLASS + (extraClass === undefined ? '' : ' ' + extraClass)
  btn.setAttribute('aria-label', label)
  btn.title = label
  btn.innerHTML = svg
  return btn
}

function buildRowActions(li: Element): HTMLElement {
  const actions = doc.createElement('span')
  actions.className = ACTIONS_CLASS

  const downloadBtn = iconButton(DL_LABEL, ICON_DOWNLOAD)
  downloadBtn.addEventListener('click', (event) => {
    /* 阻止冒泡到行按钮（行按钮的 click 会打开文件预览） */
    event.preventDefault()
    event.stopPropagation()
    startDownload(li, downloadBtn)
  })

  const deleteBtn = iconButton(DEL_LABEL, ICON_TRASH, DANGER_CLASS)
  deleteBtn.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const path = li.getAttribute('data-files-path')
    if (path === null || path === '') {
      showToast('无法获取文件路径')
      return
    }
    const root = treeRootFor(li)
    if (root === null || !isAbsoluteWorkspacePath(root)) {
      showToast('无法获取工作区根目录')
      return
    }
    showDeleteConfirm(path, root, deleteBtn)
  })

  actions.append(downloadBtn, deleteBtn)
  return actions
}

/** Add download + delete buttons to every file row that lacks them. */
function decorateRows(): void {
  const rows = doc.querySelectorAll(FILE_ROW_SELECTOR)
  for (let i = 0; i < rows.length; i++) {
    // 用 tagName 判定而非 instanceof HTMLLIElement：bundle 在全局作用域求值时
    // HTMLLIElement 未必是自由标识符（宿主环境差异），instanceof 会直接抛 ReferenceError。
    const li = rows[i]
    if (li === undefined || li.tagName.toUpperCase() !== 'LI') continue
    if (li.querySelector('.' + ACTIONS_CLASS) !== null) continue
    li.classList.add(HOST_CLASS)
    li.append(buildRowActions(li))
  }
}

/** 在刷新按钮左侧放一个上传按钮，只挂一次。 */
function decorateHeader(): void {
  if (doc.querySelector('.' + UP_BTN_CLASS) !== null) return
  const reload = doc.querySelector(RELOAD_SELECTOR)
  if (reload === null) return
  const parent = reload.parentElement
  if (parent === null) return
  const btn = iconButton(UP_LABEL, ICON_UPLOAD, UP_BTN_CLASS)
  btn.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const root = currentRoot()
    if (root === null || !isAbsoluteWorkspacePath(root)) {
      showToast('无法获取目标目录路径')
      return
    }
    uploadFiles(root, btn)
  })
  parent.insertBefore(btn, reload)
}

let scheduled = false
/** 连续变更批次计数：若页面持续高频重排（注入按钮被 React 反复冲掉），停用观察器止损。 */
let mutationBatches = 0

function scheduleDecorate(): void {
  if (scheduled) return
  scheduled = true
  nextFrame(() => {
    scheduled = false
    decorateHeader()
    decorateRows()
  })
}

function observeTree(): void {
  const body = doc.body
  if (body === null || MutationObserverCtor === undefined) return
  const observer = new MutationObserverCtor(() => {
    mutationBatches++
    if (mutationBatches > 300) {
      console.warn('[dsh-file-extra] change storm detected — observer stopped; existing buttons remain')
      observer.disconnect()
      return
    }
    scheduleDecorate()
  })
  observer.observe(body, { childList: true, subtree: true })
}

/* ──────────────────────────────────────────────────────────
 * Document preview — selection comments
 * ────────────────────────────────────────────────────────── */

/* ── CSS selectors for locating the document preview area ── */
const PREVIEW_SELECTORS = [
  '[data-code-preview]',
  '[data-sidebar-right-session]',
  '[data-slot="sidebar.right.pane.tab"]',
].join(',')

interface SelectionInfo {
  text: string
  filePath: string
  startLine: number | null
  endLine: number | null
  startCol: number | null
  endCol: number | null
}

/* ── State ── */
let currentSelection: SelectionInfo | null = null
let toolbarVisible = false
let dialogVisible = false

/* ── Composer slot capture (official conversation.input API) ── */

/** Minimal face of the stable public input actions exposed to session-scope slots. */
interface ComposerInputActions {
  captureInsertion(): unknown
  insertText(text: string, span: unknown): boolean
}

let pluginCtx: any = null
let capturedInputActions: ComposerInputActions | null = null
let composerSlotInjected = false

/**
 * Passively occupy `conversation.input.activity` (kind: single, scope: session)
 * to capture the active composer's InputActions — the official plugin channel
 * (see dsh fixture apps/web/tests/fixtures/plugins/fixture-input-extension).
 * The render body only stores props.inputActions and renders nothing.
 * Idempotent; called again on the first send in case the `slots` service was
 * not yet available when apply() ran (boot ordering).
 */
function ensureComposerSlot(): void {
  if (composerSlotInjected || !pluginCtx) return
  try {
    /* ctx.get bypasses cordis 4's strict inject check on property access */
    const slots = pluginCtx.get?.('slots')
    if (!slots || typeof slots.inject !== 'function') return
    composerSlotInjected = true
    slots.inject('conversation.input.activity', () => slots.register(
      { name: 'conversation.input.activity' },
      (props: any) => {
        if (props && props.inputActions) capturedInputActions = props.inputActions as ComposerInputActions
        /* render nothing; the slot machinery's error boundary tolerates null */
        return null
      },
    ))
  } catch {
    /* leave the flag false so the next send retries */
    composerSlotInjected = false
  }
}

const TOOLBAR_CSS = [
  'position:fixed;z-index:2147483646;',
  'display:none;align-items:center;gap:6px;',
  'padding:4px 8px;',
  'background:#1e1e2e;color:#cdd6f4;',
  'border:1px solid rgba(205,214,244,.2);border-radius:8px;',
  'box-shadow:0 4px 16px rgba(0,0,0,.35);',
  'font:12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;',
  'user-select:none;',
].join('')

const SEL_INFO_CSS = 'max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.65;'
const INPUT_CSS = [
  'width:100%;box-sizing:border-box;padding:8px 10px;margin-top:6px;',
  'border:1px solid rgba(205,214,244,.2);border-radius:6px;',
  'background:rgba(255,255,255,.05);color:#cdd6f4;',
  'font:13px/1.5 Consolas,Monaco,monospace;resize:vertical;',
].join('')

const CODE_PRE_CSS = [
  'max-height:140px;overflow:auto;margin:8px 0 0;',
  'padding:8px 10px;border-radius:6px;',
  'background:rgba(0,0,0,.25);border:1px solid rgba(205,214,244,.1);',
  'font:12px/1.4 Consolas,Monaco,monospace;white-space:pre-wrap;word-break:break-all;',
].join('')

/**
 * Is `node` inside the document-preview area of the right sidebar?
 * Walks up through Shadow DOM boundaries (DSH uses Shadow DOM extensively).
 */
function inPreviewArea(node: Node | null): boolean {
  return closestAcrossShadow(node, PREVIEW_SELECTORS) !== null
}

/** Find the active right-sidebar document tab and return its visible title text. */
function findActiveDocTab(): HTMLElement | null {
  const candidates = doc.querySelectorAll(
    '[data-slot="sidebar.right.pane.tab"], [data-active="true"], [aria-selected="true"]',
  )
  for (let i = 0; i < candidates.length; i++) {
    const tab = candidates[i]
    if (!(tab instanceof HTMLElement)) continue
    const attrs = (tab.getAttribute('data-slot-key') ?? '') + ' ' + (tab.className ?? '')
    if (/document|preview|text|code/i.test(attrs)) return tab
  }
  return null
}

/**
 * Best-effort file path for a selection anchored in the right sidebar.
 * Primary sources are the document preview's own DOM (verified against
 * ui-sidebar-documentpreview): the header PathLabel carries the complete path
 * in its `title`, and the preview root carries the resource address. Falls
 * back to the tab chip title (basename at open time) and older heuristics.
 * Returns empty string when nothing found.
 */
function getFilePath(anchor: Node | null): string {
  if (anchor) {
    /* document preview header: PathLabel `title` = complete path */
    try {
      const preview = closestAcrossShadow(anchor, '[data-textpreview-url]')
      if (preview) {
        const label = preview.querySelector('[data-textpreview-path]')
        const path = label?.getAttribute('title') ?? label?.textContent
        if (path && path.trim()) return path.trim()
        /* resource address: dsh-resource://file/session/<sessionId>/<path> */
        const address = preview.getAttribute('data-textpreview-url') ?? ''
        const mark = address.indexOf('/session/')
        if (mark !== -1) {
          const rest = address.slice(mark + '/session/'.length)
          const cut = rest.indexOf('/')
          if (cut !== -1) {
            const raw = rest.slice(cut + 1)
            try { return decodeURIComponent(raw) } catch { return raw }
          }
        }
      }
    } catch { /* fall through */ }

    /* tab chip title (basename): the body and its chip share the tab id */
    try {
      const body = closestAcrossShadow(anchor, 'div[data-sidebar-right-tab]')
      const tabId = body?.getAttribute('data-sidebar-right-tab')
      if (tabId) {
        const safe = tabId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        const chip = doc.querySelector(`span[data-sidebar-right-tab="${safe}"]`)
        const title = chip?.textContent?.trim()
        if (title) return title
      }
    } catch { /* fall through */ }
  }

  /* legacy fallbacks: active tab attributes / titles */
  const tab = findActiveDocTab()
  if (tab) {
    /* title / label element */
    const title = tab.querySelector('[title]')
    if (title?.getAttribute('title')) return title.getAttribute('title')!

    const fileName = tab.querySelector(
      '[data-file-name], [data-file-path], [data-resource-path], .tab-title, .file-name',
    )
    if (fileName?.textContent) return fileName.textContent.trim()

    /* tab-info region */
    const info = tab.querySelector('[data-tab-info], .tab-info, .tab-label')
    if (info?.textContent) return info.textContent.trim()

    /* contentId / address data attribute */
    const withAddr = tab.querySelector('[data-content-id], [data-address]')
    const addr = withAddr?.getAttribute('data-content-id') ?? withAddr?.getAttribute('data-address') ?? ''
    if (addr) {
      try { return new URL(addr).pathname.replace(/^\/session\/[^/]+\//, '/') } catch { return addr }
    }

    /* fallback: visible title text */
    const txt = tab.querySelector('[data-slot="sidebar.right.pane.tab.title"]')?.textContent
      ?? tab.querySelector('.title, h3, h4, span')?.textContent
    if (txt && txt.trim()) return txt.trim()
  }

  /* search inside shadow roots */
  const shadowPath = findInShadowRoots('[title]')
  if (shadowPath?.getAttribute('title')) return shadowPath.getAttribute('title')!

  /* fallback: any element with a path-like title anywhere in the sidebar */
  const sidebars = doc.querySelectorAll('[data-sidebar-right-session]')
  for (let i = 0; i < sidebars.length; i++) {
    const titled = sidebars[i]!.querySelectorAll('[title]')
    for (let j = 0; j < titled.length; j++) {
      const t = titled[j]!.getAttribute('title')
      if (t && (t.includes('/') || t.includes('\\') || t.includes('.'))) return t
    }
  }

  return ''
}

/** Search all shadow roots in the document for the first element matching `selector`. */
function findInShadowRoots(selector: string): Element | null {
  const allElements = doc.querySelectorAll('*')
  for (let i = 0; i < allElements.length; i++) {
    const host = allElements[i]!
    if (host.shadowRoot) {
      const found = host.shadowRoot.querySelector(selector)
      if (found) return found
    }
  }
  return null
}

/** A line/column span the selection covers inside the preview renderer. */
interface LineSpan {
  start: number
  end: number
  startCol: number | null
  endCol: number | null
}

/**
 * Determine which source lines (and columns) the selection covers.
 * DSH's CodeBlock renders one global `.line` span per source line and paints
 * the visible numbers with a CSS counter (`counter(source-line)`), so the
 * numbers are ABSENT from the DOM — lines are `.line` ordinals within their
 * `<code>` parent (markdown fences restart numbering per block). Falls back
 * to data-line/class heuristics, then null when nothing matches.
 */
function detectLines(sel: Selection): LineSpan | null {
  if (!sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  const container = range.commonAncestorContainer instanceof HTMLElement
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement
  if (!container) return null

  const previewRoot = closestAcrossShadow(container, '[data-code-preview]')
    ?? closestAcrossShadow(container, PREVIEW_SELECTORS)
  if (!previewRoot) return null

  /* 1. `.line` ordinals (CodeBlock: streaming / plain / settled-shiki arms) */
  const lines = previewRoot.querySelectorAll('pre code > .line')
  if (lines.length > 0) {
    const startEl = lineContaining(range.startContainer, lines)
      ?? adjacentIntersecting(lines, range, 'first')
    const endEl = lineContaining(range.endContainer, lines)
      ?? adjacentIntersecting(lines, range, 'last')
    const start = startEl === null ? null : ordinalOf(startEl)
    const end = endEl === null ? null : ordinalOf(endEl)
    if (start !== null && end !== null) {
      return {
        start,
        end: end < start ? start : end,
        startCol: columnOf(range, startEl!, 'start'),
        endCol: columnOf(range, endEl!, 'end'),
      }
    }
  }

  /* 2. legacy: data-line / class patterns (other renderers) */
  const walker = doc.createTreeWalker(previewRoot, NodeFilter.SHOW_ELEMENT)
  let start: number | null = null
  let end: number | null = null

  const lineOf = (e: Element): number | null => {
    const dl = e.getAttribute('data-line')
    if (dl) { const n = parseInt(dl, 10); if (!isNaN(n)) return n }
    const cls = e.className
    if (typeof cls === 'string') {
      const m = cls.match(/(?:line[-_]?|l)(\d+)/i)
      if (m && m[1] !== undefined) return parseInt(m[1], 10)
    }
    return null
  }

  let node = walker.nextNode() as Element | null
  while (node) {
    if (node instanceof Element && range.intersectsNode(node)) {
      const ln = lineOf(node)
      if (ln !== null) {
        if (start === null || ln < start) start = ln
        if (end === null || ln > end) end = ln
      }
    }
    node = walker.nextNode() as Element | null
  }

  if (start !== null && end !== null) return { start, end, startCol: null, endCol: null }
  return null
}

/** The `.line` span containing `node`, when it belongs to `lines`. */
function lineContaining(node: Node | null, lines: NodeListOf<Element>): Element | null {
  let current: Node | null = node
  while (current) {
    if (current instanceof Element && current.classList.contains('line')) {
      for (let i = 0; i < lines.length; i++) if (lines[i] === current) return current
      return null
    }
    current = current.parentNode
  }
  return null
}

/** First/last `.line` span the range intersects (boundary-node fallback). */
function adjacentIntersecting(lines: NodeListOf<Element>, range: Range, edge: 'first' | 'last'): Element | null {
  if (edge === 'first') {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (range.intersectsNode(line)) return line
    }
  } else {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!
      if (range.intersectsNode(line)) return line
    }
  }
  return null
}

/** 1-based line number: the span's ordinal among its `<code>` parent's children. */
function ordinalOf(line: Element): number | null {
  const parent = line.parentElement
  if (!parent) return null
  const siblings = parent.children
  for (let i = 0; i < siblings.length; i++) if (siblings[i] === line) return i + 1
  return null
}

/** 1-based column of one range boundary inside a line span; null when outside. */
function columnOf(range: Range, line: Element, side: 'start' | 'end'): number | null {
  try {
    const probe = doc.createRange()
    if (side === 'start') {
      probe.setStart(line, 0)
      probe.setEnd(range.startContainer, range.startOffset)
    } else {
      probe.setStart(range.endContainer, range.endOffset)
      probe.setEnd(line, line.childNodes.length)
    }
    return probe.toString().length + 1
  } catch {
    return null
  }
}

/** Read the current browser selection if it falls inside the preview area. */
function updateSelection(): SelectionInfo | null {
  const sel = doc.getSelection()
  if (!sel || sel.isCollapsed) { currentSelection = null; return null }

  const text = sel.toString().trim()
  /* anchor or focus endpoint may sit inside the preview area (dragged selections) */
  const inArea = inPreviewArea(sel.anchorNode) || inPreviewArea(sel.focusNode)
  if (!text || !inArea) { currentSelection = null; return null }

  const lines = detectLines(sel)
  currentSelection = {
    text,
    filePath: getFilePath(sel.anchorNode),
    startLine: lines?.start ?? null,
    endLine: lines?.end ?? null,
    startCol: lines?.startCol ?? null,
    endCol: lines?.endCol ?? null,
  }
  return currentSelection
}

/* ── Toolbar ── */

function positionToolbar(toolbar: HTMLElement, sel: Selection): void {
  if (!sel.rangeCount) return
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return

  const vw = window.innerWidth
  const vh = window.innerHeight
  let top = rect.top - 44
  let left = rect.left + rect.width / 2 - 140

  if (top < 8) top = rect.bottom + 8
  if (top + 48 > vh) top = vh - 56
  if (left < 8) left = 8
  if (left + 320 > vw) left = vw - 328

  toolbar.style.top = `${Math.round(top)}px`
  toolbar.style.left = `${Math.round(left)}px`
}

function showToolbar(info: SelectionInfo): void {
  let toolbar = doc.getElementById(TOOLBAR_ID)

  if (!toolbar) {
    toolbar = el('div', { id: TOOLBAR_ID, style: TOOLBAR_CSS })

    const snippet = el('span', {
      style: SEL_INFO_CSS,
      title: info.text.length > 80 ? info.text.slice(0, 200) + '...' : info.text,
    })
    snippet.textContent = info.text.length > 36 ? info.text.slice(0, 36) + '...' : info.text

    const commentBtn = el('button', { style: BTN_CSS + BTN_PRI_CSS, textContent: '\u{1F4AC} \u8BC4\u8BBA\u5E76\u63D0\u95EE' })
    const sendBtn = el('button', { style: BTN_CSS, textContent: '\u{1F4E4} \u53D1\u9001\u5230\u804A\u5929' })

    commentBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); showDialog(info) })
    sendBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); void sendToComposer(info, '') })

    toolbar.append(snippet, commentBtn, sendBtn)
    doc.body.append(toolbar)
  } else {
    const snip = toolbar.querySelector('span')
    if (snip) {
      snip.textContent = info.text.length > 36 ? info.text.slice(0, 36) + '...' : info.text
      snip.title = info.text.length > 80 ? info.text.slice(0, 200) + '...' : info.text
    }
    /* rebind click handlers with fresh selection info */
    const btns = toolbar.querySelectorAll('button')
    const newComment = el('button', { style: BTN_CSS + BTN_PRI_CSS, textContent: '\u{1F4AC} \u8BC4\u8BBA\u5E76\u63D0\u95EE' })
    const newSend = el('button', { style: BTN_CSS, textContent: '\u{1F4E4} \u53D1\u9001\u5230\u804A\u5929' })
    newComment.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); showDialog(info) })
    newSend.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); void sendToComposer(info, '') })
    if (btns[0]) btns[0].replaceWith(newComment)
    if (btns[1]) btns[1].replaceWith(newSend)
  }

  const sel = doc.getSelection()
  if (sel) positionToolbar(toolbar, sel)
  toolbar.style.display = 'flex'
  toolbarVisible = true
}

function hideToolbar(): void {
  const toolbar = doc.getElementById(TOOLBAR_ID)
  if (toolbar) toolbar.style.display = 'none'
  toolbarVisible = false
}

/* ── Comment dialog ── */

function showDialog(info: SelectionInfo): void {
  hideToolbar()
  hideDialog()
  dialogVisible = true

  const overlay = el('div', { id: DIALOG_ID, style: DIALOG_OV_CSS })

  /* header */
  const closeBtn = el('button', { style: CLOSE_BTN_CSS, textContent: '\u00D7' })
  closeBtn.addEventListener('click', () => hideDialog())
  const header = el('div', { style: DIALOG_HDR_CSS }, [
    el('div', { style: 'font-weight:700;font-size:15px;', textContent: '\u{1F4DD} \u6DFB\u52A0\u8BC4\u8BBA\u5E76\u63D0\u95EE' }),
    closeBtn,
  ])

  /* body */
  const metaParts: string[] = []
  if (info.filePath) metaParts.push('\u{1F4C4} ' + info.filePath)
  const rangeLabel = lineRangeLabel(info)
  if (rangeLabel) metaParts.push(rangeLabel)
  const meta = el('div', { style: META_CSS })
  meta.textContent = metaParts.join('  |  ') || '(\u672A\u77E5\u6587\u4EF6)'

  const codePre = el('pre', { style: CODE_PRE_CSS })
  codePre.textContent = info.text.length > 500 ? info.text.slice(0, 500) + '\n...' : info.text

  const textarea = el('textarea', {
    placeholder: '\u8F93\u5165\u4F60\u7684\u8BC4\u8BBA\u6216\u95EE\u9898\u2026',
    style: INPUT_CSS + 'min-height:80px;',
  }) as HTMLTextAreaElement

  const body = el('div', { style: DIALOG_BODY_CSS }, [meta, codePre, textarea])

  /* footer */
  const cancelBtn = el('button', { style: BTN_CSS, textContent: '\u53D6\u6D88' })
  cancelBtn.addEventListener('click', () => hideDialog())

  const sendCommentBtn = el('button', { style: BTN_CSS + BTN_PRI_CSS, textContent: '\u{1F680} \u53D1\u9001\u5230\u804A\u5929' })
  sendCommentBtn.addEventListener('click', () => {
    const comment = textarea.value.trim()
    if (!comment) { textarea.style.borderColor = '#f38ba8'; textarea.focus(); return }
    void sendToComposer(info, comment)
    hideDialog()
  })

  const sendOnlyBtn = el('button', { style: BTN_CSS, textContent: '\u{1F4E4} \u53EA\u53D1\u4EE3\u7801' })
  sendOnlyBtn.addEventListener('click', () => {
    void sendToComposer(info, '')
    hideDialog()
  })

  const footer = el('div', { style: DIALOG_FTR_CSS }, [cancelBtn, sendOnlyBtn, sendCommentBtn])
  const box = el('div', { style: DIALOG_BOX_CSS }, [header, body, footer])
  overlay.append(box)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hideDialog() })
  doc.body.append(overlay)

  /* Enter sends, Shift+Enter for newline */
  timers.setTimeout(() => {
    textarea.focus()
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendCommentBtn.click()
      }
      if (e.key === 'Escape') hideDialog()
    })
  }, 60)
}

function hideDialog(): void {
  const d = doc.getElementById(DIALOG_ID)
  if (d) d.remove()
  dialogVisible = false
}

/* ── Composer integration ── */

/** Human label for the selected span: `行 12:5-14:20` / `行 12-14` / `行 12`. */
function lineRangeLabel(info: SelectionInfo): string {
  if (info.startLine === null) return ''
  const sc = info.startCol
  const ec = info.endCol
  const endLine = info.endLine ?? info.startLine
  const hasCols = sc !== null && ec !== null
  if (endLine === info.startLine) {
    return hasCols
      ? '\u884C ' + info.startLine + ':' + sc + '-' + info.startLine + ':' + ec
      : '\u884C ' + info.startLine
  }
  return hasCols
    ? '\u884C ' + info.startLine + ':' + sc + '-' + endLine + ':' + ec
    : '\u884C ' + info.startLine + '-' + endLine
}

/** Format the selection + optional comment into a structured message. */
function formatMessage(info: SelectionInfo, comment: string): string {
  const parts: string[] = []

  /* header: file + lines */
  let header = ''
  if (info.filePath) header += '\u{1F4C4} `' + info.filePath + '`'
  const range = lineRangeLabel(info)
  if (range) header += (header ? ' ' : '') + '\u2014 ' + range
  if (header) parts.push(header)

  /* selected code */
  parts.push('```')
  parts.push(info.text)
  parts.push('```')

  /* user comment */
  if (comment) parts.push('\u{1F4AC} ' + comment)

  parts.push('')
  return parts.join('\n')
}

/**
 * Locate the visible main chat composer: DSH's composer binds a Lexical editor
 * to a contenteditable root. Prefers the lowest such element on screen (the
 * composer bar sits at the bottom) and skips right-sidebar panes.
 */
function findComposerElement(): HTMLElement | null {
  const nodes = doc.querySelectorAll('[contenteditable="true"]')
  let best: HTMLElement | null = null
  let bestTop = -1
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (!(node instanceof HTMLElement)) continue
    const rect = node.getBoundingClientRect()
    if (rect.width < 40 || rect.height < 16) continue
    /* the right sidebar hosts its own panes; the chat composer is in the main area */
    if (closestAcrossShadow(node, PREVIEW_SELECTORS)) continue
    if (rect.top > bestTop) { bestTop = rect.top; best = node }
  }
  return best
}

/**
 * Insert text through the composer's own paste pipeline (multiline →
 * paragraphs, undo integrated), with execCommand as the fallback. Returns
 * whether an insertion path consumed the text.
 */
function pasteIntoComposer(text: string): boolean {
  const target = findComposerElement()
  if (!target) return false
  target.focus()
  /* synthetic paste event: Lexical's DOM paste listener reads clipboardData */
  try {
    const data = new DataTransfer()
    data.setData('text/plain', text)
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    /* dispatchEvent === false → preventDefault → a handler consumed the paste */
    if (!target.dispatchEvent(event)) return true
  } catch { /* DataTransfer / ClipboardEvent may be unavailable */ }
  /* fallback: execCommand keeps the editor's undo integration */
  try {
    return doc.execCommand('insertText', false, text)
  } catch {
    return false
  }
}

/** Deliver formatted text to the conversation composer; layered fallbacks, each isolated. */
async function sendToComposer(info: SelectionInfo, comment: string): Promise<void> {
  const text = formatMessage(info, comment)

  /* 1. Official channel: InputActions captured from the composer activity slot
   *    (revision-guarded, undo-integrated, newlines split paragraphs). */
  try {
    ensureComposerSlot()
    const actions = capturedInputActions
    if (actions) {
      const span = actions.captureInsertion()
      if (span != null && actions.insertText(text, span)) {
        console.debug('[dsh-file-extra] sent via conversation.input slot')
        return
      }
    }
  } catch (err) {
    console.debug('[dsh-file-extra] slot insert unavailable:', err)
  }

  /* 2. DOM paste into the visible main composer (the app's own paste pipeline). */
  try {
    if (pasteIntoComposer(text)) {
      console.debug('[dsh-file-extra] sent via composer paste event')
      return
    }
  } catch (err) {
    console.debug('[dsh-file-extra] composer paste failed:', err)
  }

  /* 3. Legacy: connection.rpc (only reachable if a connection was cached). */
  try {
    const conn = getConnection()
    if (conn?.rpc?.call) {
      await conn.rpc.call('/api', 'conversation/input-paste', { args: { text } })
      console.debug('[dsh-file-extra] sent via connection.rpc')
      return
    }
  } catch (err) {
    console.debug('[dsh-file-extra] connection.rpc failed:', err)
  }

  /* 4. Legacy: Cordis context exposed on a global (best-effort, some builds). */
  try {
    const globalCtx = globals.__dshContext
    if (globalCtx?.conversation?.input) {
      const sessionId = globalCtx.sidebarRight?.mounted?.getSnapshot?.()
      if (sessionId) {
        const sessionCtx = globalCtx.sessions?.scope?.(sessionId)
        if (sessionCtx) {
          const input = globalCtx.conversation.input.for(sessionCtx)
          input.focus()
          input.paste(text)
          console.debug('[dsh-file-extra] sent via __dshContext')
          return
        }
      }
    }
  } catch (err) {
    console.debug('[dsh-file-extra] __dshContext paste failed:', err)
  }

  /* 5. Last resort: clipboard (user can paste manually). */
  try {
    await navigator.clipboard.writeText(text)
    console.debug('[dsh-file-extra] composer not reached — text copied to clipboard')
  } catch {
    /* clipboard API may not be available */
  }
}

/* ──────────────────────────────────────────────────────────
 * Event wiring & init
 * ────────────────────────────────────────────────────────── */

function onSelectionChange(): void {
  if (dialogVisible) return

  const sel = doc.getSelection()
  if (!sel) return

  const info = updateSelection()
  if (info) {
    console.debug('[dsh-file-extra] selection:', {
      len: info.text.length,
      path: info.filePath,
      lines: info.startLine,
    })
    showToolbar(info)
  } else if (toolbarVisible) {
    hideToolbar()
  }
}

function onGlobalClick(e: Event): void {
  if (dialogVisible) return
  if (!toolbarVisible) return
  const target = e.target as HTMLElement | null
  if (!target) return

  const toolbar = doc.getElementById(TOOLBAR_ID)
  if (toolbar?.contains(target)) return

  /* click outside preview area → dismiss toolbar */
  if (!inPreviewArea(target)) hideToolbar()
}

/** Resolve the connection lazily (not in inject — it must not block loading). */
function getConnection(): any {
  const cached = globals.__dshFileExtraConnection
  if (cached) return cached

  const globalCtx = globals.__dshContext ?? globals.__cordisContext
  if (globalCtx?.connection?.rpc) return globalCtx.connection

  return null
}

function init(): void {
  installStyle()
  decorateHeader()
  decorateRows()
  observeTree()
  doc.addEventListener('selectionchange', onSelectionChange)
  doc.addEventListener('click', onGlobalClick)
  console.log('[dsh-file-extra] plugin loaded: file actions + selection comments')
}

/* ── Client plugin contract ── */

function apply(ctx: any): void {
  if (globals[GUARD_KEY] === true) return
  globals[GUARD_KEY] = true

  /* connection is optional — resolve via ctx.get (a bare ctx.connection property
   * access throws under cordis 4 strict inject rules, silently killing the cache) */
  try {
    const conn = typeof ctx?.get === 'function' ? ctx.get('connection') : ctx?.connection
    if (conn?.rpc && typeof conn.rpc.call === 'function') {
      globals.__dshFileExtraConnection = conn
    }
  } catch { /* connection may not be available yet */ }

  /* capture the official composer input actions (non-fatal; retried on send) */
  pluginCtx = ctx
  try { ensureComposerSlot() } catch { /* slots service may not be up yet */ }

  try {
    init()
  } catch (err) {
    /* never let init failure silently kill the plugin */
    globals.__dshFileExtraError = String(err)
  }
}

/* no inject: connection is resolved lazily at send time */
module.exports = { name: PLUGIN_ID, apply }
