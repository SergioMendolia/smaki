import { promises as fsp } from 'node:fs'
import { contentRoot, getPageDetail, safeJoin } from '../../../utils/content'
import { requireUser } from '../../../utils/auth'
import { deletePageDoc, syncAll } from '../../../utils/indexer'

/** delete a page's markdown file and remove it from the index (files stay: they belong to their folder) */
export default defineEventHandler(async (event) => {
  requireUser(event)
  const rawPath = getRouterParam(event, 'path') ?? ''
  const { page } = await getPageDetail(rawPath)
  if (!page) {
    throw createError({ statusCode: 404, statusMessage: 'Page not found' })
  }

  const abs = safeJoin(contentRoot(), page.file)
  await fsp.rm(abs, { force: true })

  await deletePageDoc(page.path)
  await syncAll()
  return { ok: true }
})