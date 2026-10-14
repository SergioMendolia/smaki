import { eq } from 'drizzle-orm'
import { requireAdmin } from '../../../utils/auth'
import { tables, useDb } from '../../../utils/db'

/** the chunks actually indexed for one file (what search and RAG see) */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = getRouterParam(event, 'id') ?? ''
  const db = useDb()
  const file = db.select().from(tables.files).where(eq(tables.files.id, id)).get()
  if (!file) {
    throw createError({ statusCode: 404, statusMessage: 'File not indexed' })
  }

  const chunks = db
    .select()
    .from(tables.fileChunks)
    .where(eq(tables.fileChunks.file_id, id))
    .all()
    .sort((a, b) => a.chunk_index - b.chunk_index)
    .map(c => ({ index: c.chunk_index, kind: c.kind as 'text' | 'vision', page: c.page, content: c.content }))

  return {
    file: {
      ...file,
      vision: file.vision == null ? null : Boolean(file.vision),
      indexedAt: new Date(file.indexedAt).toISOString()
    },
    chunks
  }
})