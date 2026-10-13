import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { contentRoot, safeJoin, sanitizePagePath, walkContent } from '../../../utils/content'
import { syncAll } from '../../../utils/indexer'
import { requireUser } from '../../../utils/auth'

/** create a new page as <path>.md inside its parent folder */
export default defineEventHandler(async (event) => {
  requireUser(event)
  const body = await readBody<{ path?: string, source?: string }>(event)
  const pagePath = sanitizePagePath(body.path ?? '')
  if (!pagePath) {
    throw createError({ statusCode: 400, statusMessage: 'A page path is required' })
  }
  const source = typeof body.source === 'string' ? body.source : ''
  if (!source.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Page source cannot be empty' })
  }

  const { pages } = await walkContent()
  if (pages.some(p => p.path === pagePath)) {
    throw createError({ statusCode: 409, statusMessage: 'A page already exists at this path' })
  }

  const fileName = pagePath.split('/')!.pop()!
  const dir = pagePath.includes('/') ? pagePath.slice(0, pagePath.lastIndexOf('/')) : ''
  const absDir = safeJoin(contentRoot(), dir)
  await fsp.mkdir(absDir, { recursive: true })
  await fsp.writeFile(path.join(absDir, `${fileName}.md`), source, 'utf8')
  await syncAll()
  return { ok: true, path: pagePath }
})