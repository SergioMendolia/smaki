import { promises as fsp } from 'node:fs'
import { requireAdmin } from '../../utils/auth'
import { contentRoot, safeJoin } from '../../utils/content'
import { enqueueFile, enqueueSync, type IndexJob } from '../../utils/indexQueue'

/**
 * Enqueue reindexing work; returns immediately, the queue processes it in the
 * background. Body: { rel: "path/to/file.pdf" } | { full: true } | { sync: true }
 */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const body = await readBody(event).catch(() => ({})) as { rel?: string, full?: boolean, sync?: boolean }

  let job: IndexJob
  if (typeof body.rel === 'string' && body.rel.trim()) {
    const rel = body.rel.trim()
    // refuse traversal and files that no longer exist
    const abs = safeJoin(contentRoot(), rel)
    await fsp.stat(abs).catch(() => {
      throw createError({ statusCode: 404, statusMessage: `File not found: ${rel}` })
    })
    job = enqueueFile(rel)
  } else if (body.full) {
    job = enqueueSync(true)
  } else {
    job = enqueueSync(false)
  }
  setResponseStatus(event, 202)
  return job
})