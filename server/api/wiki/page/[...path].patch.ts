import { existsSync, promises as fsp  } from 'node:fs'
import { contentRoot, safeJoin, sanitizePagePath } from '../../../utils/content'
import { requireUser } from '../../../utils/auth'
import { syncAll } from '../../../utils/indexer'

/** move a page (.md file) or a folder (whole directory) into another folder */
export default defineEventHandler(async (event) => {
  requireUser(event)
  const pagePath = sanitizePagePath(getRouterParam(event, 'path') ?? '')
  const body = await readBody<{ to?: unknown }>(event).catch(() => ({}) as { to?: unknown })
  if (typeof body?.to !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Target folder is required' })
  }
  const targetDir = sanitizePagePath(body.to)
  if (!pagePath) {
    throw createError({ statusCode: 400, statusMessage: 'The root cannot be moved' })
  }
  if (targetDir === pagePath || targetDir.startsWith(pagePath + '/')) {
    throw createError({ statusCode: 400, statusMessage: 'Cannot move something into itself' })
  }

  const root = contentRoot()
  const pageAbs = safeJoin(root, pagePath)
  const name = pagePath.split('/')!.pop()!
  const newBase = targetDir ? `${targetDir}/${name}` : name

  // a page: move the .md file (folder files stay where they are)
  if (existsSync(`${pageAbs}.md`)) {
    if (existsSync(safeJoin(root, `${newBase}.md`))) {
      throw createError({ statusCode: 409, statusMessage: 'A page with this name already exists in the target folder' })
    }
    await fsp.mkdir(safeJoin(root, targetDir), { recursive: true })
    await fsp.rename(`${pageAbs}.md`, safeJoin(root, `${newBase}.md`))
    await syncAll()
    return { path: newBase, isPage: true }
  }

  // a folder: move the whole directory (nested pages and files follow)
  if (existsSync(pageAbs) && (await fsp.stat(pageAbs)).isDirectory()) {
    if (existsSync(safeJoin(root, newBase))) {
      throw createError({ statusCode: 409, statusMessage: 'A folder with this name already exists in the target folder' })
    }
    await fsp.mkdir(safeJoin(root, targetDir), { recursive: true })
    await fsp.rename(pageAbs, safeJoin(root, newBase))
    await syncAll()
    return { path: newBase, isPage: false }
  }

  throw createError({ statusCode: 404, statusMessage: 'Nothing to move at this path' })
})