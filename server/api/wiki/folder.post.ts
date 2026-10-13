import { existsSync, promises as fsp  } from 'node:fs'
import { contentRoot, safeJoin, sanitizePagePath } from '../../utils/content'
import { requireUser } from '../../utils/auth'

/** create a folder (mkdir -p, parents allowed) */
export default defineEventHandler(async (event) => {
  requireUser(event)
  const body = await readBody<{ path?: unknown }>(event).catch(() => ({}) as { path?: unknown })
  if (typeof body?.path !== 'string' || !body.path.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Folder name is required' })
  }
  const folderPath = sanitizePagePath(body.path)
  if (!folderPath) {
    throw createError({ statusCode: 400, statusMessage: 'Folder name is required' })
  }
  const abs = safeJoin(contentRoot(), folderPath)
  if (existsSync(`${abs}.md`)) {
    throw createError({ statusCode: 409, statusMessage: 'A page already exists at this path' })
  }
  if (existsSync(abs)) {
    throw createError({ statusCode: 409, statusMessage: 'Folder already exists' })
  }
  await fsp.mkdir(abs, { recursive: true })
  return { path: folderPath }
})