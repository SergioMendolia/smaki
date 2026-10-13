import { existsSync, promises as fsp  } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { CHUNKS_COLLECTION } from '../../../utils/bootstrap'
import { contentRoot, safeJoin, sanitizePagePath } from '../../../utils/content'
import { tables, useDb } from '../../../utils/db'
import { requireUser } from '../../../utils/auth'
import { indexFile } from '../../../utils/indexer'
import { useTypesense } from '../../../utils/typesense'

/** move a file to another folder: rename on disk, re-index at its new path */
export default defineEventHandler(async (event) => {
  requireUser(event)
  const id = getRouterParam(event, 'id') ?? ''
  const body = await readBody<{ dir?: unknown }>(event).catch(() => ({}) as { dir?: unknown })
  if (typeof body?.dir !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Target folder is required' })
  }
  const targetDir = sanitizePagePath(body.dir)

  const db = useDb()
  const row = db
    .select()
    .from(tables.files)
    .where(eq(tables.files.id, id))
    .get()
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' })
  }
  if (targetDir === row.dir) {
    throw createError({ statusCode: 400, statusMessage: 'File is already in this folder' })
  }

  const oldRel = row.dir ? `${row.dir}/${row.filename}` : row.filename
  const newRel = targetDir ? `${targetDir}/${row.filename}` : row.filename
  const newAbs = safeJoin(contentRoot(), newRel)
  if (existsSync(newAbs)) {
    throw createError({ statusCode: 409, statusMessage: 'A file with this name already exists in the target folder' })
  }

  await fsp.mkdir(path.dirname(newAbs), { recursive: true })
  await fsp.rename(safeJoin(contentRoot(), oldRel), newAbs)

  // drop the old index entries (old id is the md5 of the old path), index the new location
  await useTypesense()
    .collections(CHUNKS_COLLECTION)
    .documents()
    .delete({ filter_by: `file_id:=${id}` } as never)
    .catch(() => {})
  db.delete(tables.files)
    .where(eq(tables.files.id, id))
    .run()
  return await indexFile(newRel)
})