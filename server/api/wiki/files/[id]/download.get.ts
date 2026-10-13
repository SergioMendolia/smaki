import { promises as fsp } from 'node:fs'
import { eq } from 'drizzle-orm'
import { contentRoot, safeJoin } from '../../../../utils/content'
import { tables, useDb } from '../../../../utils/db'
import { requireUser } from '../../../../utils/auth'

/** stream a file (inline view in the modal / download) */
export default defineEventHandler(async (event) => {
  requireUser(event)
  const id = getRouterParam(event, 'id') ?? ''
  const row = useDb()
    .select()
    .from(tables.files)
    .where(eq(tables.files.id, id))
    .get()
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' })
  }
  const rel = row.dir ? `${row.dir}/${row.filename}` : row.filename
  const abs = safeJoin(contentRoot(), rel)
  try {
    const stat = await fsp.stat(abs)
    if (!stat.isFile()) throw new Error('not a file')
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'File missing on disk' })
  }
  setResponseHeader(event, 'content-type', row.mime)
  setResponseHeader(event, 'content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`)
  return await fsp.readFile(abs)
})