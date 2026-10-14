import { promises as fsp } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { eq } from 'drizzle-orm'
import { requireUser } from '../../../utils/auth'
import { contentRoot, safeJoin, walkContent } from '../../../utils/content'
import { tables, useDb } from '../../../utils/db'
import { pdfVisionEnabled } from '../../../utils/vision'

export interface DocumentChunk {
  index: number
  kind: 'text' | 'vision'
  page: number | null
  content: string
}

function md5(input: string | Buffer): string {
  return crypto.createHash('md5').update(input).digest('hex')
}

/** document page payload: the file, its indexation status and its indexed chunks */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const rawPath = getRouterParam(event, 'path') ?? ''
  const rel = rawPath
    .split('/')
    .map(s => decodeURIComponent(s))
    .filter(s => s && s !== '.' && s !== '..' && !s.includes('\\') && !s.includes('\0'))
    .join('/')
  if (!rel) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  // must exist on disk
  const abs = safeJoin(contentRoot(), rel)
  const diskStat = await fsp.stat(abs).catch(() => null)
  if (!diskStat?.isFile()) throw createError({ statusCode: 404, statusMessage: 'Document not found' })

  const db = useDb()
  const id = md5(rel)
  const row = db.select().from(tables.files).where(eq(tables.files.id, id)).get()
  const buffer = await fsp.readFile(abs)
  const diskHash = md5(buffer)
  const status: 'indexed' | 'stale' | 'not-indexed' = !row
    ? 'not-indexed'
    : row.hash === diskHash
      ? 'indexed'
      : 'stale'

  const chunkRows = db
    .select()
    .from(tables.fileChunks)
    .where(eq(tables.fileChunks.file_id, id))
    .all()
    const chunks: DocumentChunk[] = chunkRows
      .sort((a, b) => a.chunk_index - b.chunk_index)
      .map(c => ({ index: c.chunk_index, kind: c.kind as 'text' | 'vision', page: c.page, content: c.content }))

  // make sure the folder listing knows about files not indexed yet
  if (!row) {
    const { files } = await walkContent()
    if (!files.some(f => f.rel === rel)) {
      throw createError({ statusCode: 404, statusMessage: 'Document not found' })
    }
  }

  return {
    id,
    rel,
    filename: path.basename(rel),
    dir: path.dirname(rel) === '.' ? '' : path.dirname(rel),
    mime: row?.mime ?? '',
    size: buffer.length,
    status,
    extracted: row?.extracted ?? false,
    vision: row?.vision ?? null,
    globalVision: pdfVisionEnabled(),
    indexedAt: row?.indexedAt ? new Date(row.indexedAt).toISOString() : null,
    chunks,
    isAdmin: user.role === 'admin'
  }
})