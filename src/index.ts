/**
 * dsh-file-extra — Host (Node) entry.
 *
 * Registers three things:
 *   1. The host-side `fileUploads` service (from @deepseek-ai/dsh-client-file-upload)
 *      consumed by the Session controller.
 *   2. `POST /api/dsh-file-extra/upload?path=<dir>&name=<filename>` — the exact
 *      Fetch route the browser file-tree header POSTs raw file bytes to.
 *   3. `POST /api/dsh-file-extra/delete?path=<file>` — removes one regular file
 *      (or one symbolic link, never the target it points at).
 *
 * The official `/api/file` route only owns GET/HEAD, so writes and deletes need
 * their own exact routes; the connection service authenticates the owner peer
 * before either handler runs.
 */
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { lstat, unlink, writeFile } from 'node:fs/promises'
import { FileUploads } from '@deepseek-ai/dsh-client-file-upload'
import type { Context } from '@deepseek-ai/cordis'

/**
 * 本地最小声明 `ctx.connection`（等价于 @deepseek-ai/dsh-client-connection
 * 的 Context augmentation）。该包 npm 上版本与 harness peer 冲突装不上，
 * 这里只声明用到的 fetch.register 面。
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    connection: {
      fetch: {
        register(route: {
          readonly path: string
          readonly methods: readonly string[]
          readonly requestBody: 'buffered' | 'streaming'
          readonly fetch: (request: Request) => Promise<Response>
        }): () => Promise<void>
      }
    }
  }
}

/** Plugin id — must be unique within the composed plugin tree. */
export const name = 'dsh-file-extra'

/** Host services: fileUploads deps + connection for the exact Fetch routes. */
export const inject = ['agents', 'attachments', 'commands', 'connection']

/** Exact route the browser client POSTs raw file bytes to. */
export const UPLOAD_PATH = '/api/dsh-file-extra/upload'

/** Exact route the browser client POSTs one path to for deletion. */
export const DELETE_PATH = '/api/dsh-file-extra/delete'

/** Host apply: register the fileUploads service and the two file routes. */
export function apply(ctx: Context): void {
  ctx.plugin(FileUploads)
  ctx.effect(() => ctx.connection.fetch.register({
    path: UPLOAD_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: handleUpload,
  }), 'dsh-file-extra: upload route')
  ctx.effect(() => ctx.connection.fetch.register({
    path: DELETE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: handleDelete,
  }), 'dsh-file-extra: delete route')
}

/** Validate `?path=` + `?name=` and write the raw request body to <path>/<name>. */
async function handleUpload(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const path = params.get('path')
  const name = params.get('name')
  if (path === null || path.length === 0 || path.includes('\0') || !isAbsolute(path)) {
    return new Response('absolute path required', { status: 400 })
  }
  if (name === null || name.length === 0 || name === '.' || name === '..'
    || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    return new Response('invalid file name', { status: 400 })
  }
  // basename 防穿越：只接受单段文件名（上面已拒分隔符，这里双保险）。
  if (basename(name) !== name) return new Response('invalid file name', { status: 400 })
  try {
    const bytes = Buffer.from(await request.arrayBuffer())
    await writeFile(join(path, name), bytes)
    return new Response('ok', { status: 200 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return new Response(`write failed: ${message}`, { status: 500 })
  }
}

/**
 * Delete one file by absolute path.
 *
 * `lstat` + `unlink` (not `rm`) is deliberate: directories are refused, and a
 * symbolic link is removed as a link instead of destroying its target. The
 * `root` parameter pins the delete to the file tree's own root, so the route
 * cannot be repurposed to remove files elsewhere on disk.
 */
async function handleDelete(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const path = params.get('path')
  const root = params.get('root')
  if (path === null || path.length === 0 || path.includes('\0') || !isAbsolute(path)) {
    return new Response('absolute path required', { status: 400 })
  }
  if (root === null || root.length === 0 || root.includes('\0') || !isAbsolute(root)) {
    return new Response('absolute root required', { status: 400 })
  }
  const rel = relative(resolve(root), resolve(path))
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    return new Response('outside workspace root', { status: 403 })
  }
  try {
    const info = await lstat(path)
    if (!info.isFile() && !info.isSymbolicLink()) {
      return new Response('not a regular file', { status: 403 })
    }
    await unlink(path)
    return new Response('ok', { status: 200 })
  } catch (error: unknown) {
    const status = deleteFailureStatus(error)
    const message = error instanceof Error ? error.message : String(error)
    return new Response(`delete failed: ${message}`, { status })
  }
}

/** Map filesystem errno codes onto the statuses the browser toast understands. */
function deleteFailureStatus(error: unknown): number {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : ''
  switch (code) {
    case 'ENOENT': return 404
    case 'EACCES':
    case 'EPERM':
    case 'EROFS': return 403
    default: return 500
  }
}
