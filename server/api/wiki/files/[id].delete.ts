import { eq } from 'drizzle-orm'
import { tables, useDb } from '../../../utils/db'
import { requireUser } from '../../../utils/auth'
import { removeFile } from '../../../utils/indexer'

/** delete a file: on disk, chunks in typesense, row in sqlite */
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
  await removeFile(rel)
  return { ok: true }
})