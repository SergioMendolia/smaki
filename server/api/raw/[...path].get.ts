import { promises as fsp } from 'node:fs'
import { contentRoot, safeJoin, sanitizePagePath } from '../../utils/content'
import { mimeFor } from '../../utils/text'
import { requireUser } from '../../utils/auth'

/** serve any file from the content dir (for images/files embedded in markdown) */
export default defineEventHandler(async (event) => {
  requireUser(event)
  const rawPath = getRouterParam(event, 'path') ?? ''
  const abs = safeJoin(contentRoot(), sanitizePagePath(rawPath))
  try {
    const stat = await fsp.stat(abs)
    if (!stat.isFile()) throw new Error('not a file')
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'File not found' })
  }
  setResponseHeader(event, 'content-type', mimeFor(abs))
  return await fsp.readFile(abs)
})