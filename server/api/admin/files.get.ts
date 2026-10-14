import crypto from 'node:crypto'
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { requireAdmin } from '../../utils/auth'
import { contentRoot, walkContent } from '../../utils/content'
import { tables, useDb } from '../../utils/db'
import { pageHash } from '../../utils/indexer'
import { pdfVisionEnabled } from '../../utils/vision'

export interface IndexedFile {
  id: string
  dir: string
  filename: string
  mime: string
  size: number
  status: 'indexed' | 'stale' | 'not-indexed' | 'missing'
  extracted: boolean
  chunks: number
  visionChunks: number
  vision: boolean | null
  indexedAt: string | null
}

function md5(input: string | Buffer): string {
  return crypto.createHash('md5').update(input).digest('hex')
}

/** which files are indexed, whether up to date, how many chunks each has */
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = useDb()
  const { pages, files } = await walkContent()

  // pages summary: hash comparison against the sync metadata
  const dbPages = db.select().from(tables.pages).all()
  const dbPageMap = new Map(dbPages.map(r => [r.path, r.hash]))
  const pagesSummary = {
    total: pages.length,
    upToDate: pages.filter(p => dbPageMap.get(p.path) === pageHash(p)).length
  }

  // files: disk state joined with sync metadata and chunk counts
  const dbFiles = db.select().from(tables.files).all()
  const dbFileMap = new Map(dbFiles.map(r => [r.id, r]))
  const chunkRows = db
    .select({ file_id: tables.fileChunks.file_id, kind: tables.fileChunks.kind })
    .from(tables.fileChunks)
    .all()
  const counts = new Map<string, { all: number, vision: number }>()
  for (const chunk of chunkRows) {
    const entry = counts.get(chunk.file_id) ?? { all: 0, vision: 0 }
    entry.all++
    if (chunk.kind === 'vision') entry.vision++
    counts.set(chunk.file_id, entry)
  }
  const result: IndexedFile[] = []

  const diskIds = new Set<string>()
  for (const file of files) {
    const id = md5(file.rel)
    diskIds.add(id)
    const row = dbFileMap.get(id)
    let status: IndexedFile['status']
    if (!row) {
      status = 'not-indexed'
    } else {
      const diskHash = md5(await fsp.readFile(path.join(contentRoot(), file.rel)))
      status = row.hash === diskHash ? 'indexed' : 'stale'
    }
    const chunkCount = counts.get(id) ?? { all: 0, vision: 0 }
    result.push({
      id,
      dir: file.dir,
      filename: file.filename,
      mime: row?.mime ?? '',
      size: row?.size ?? 0,
      status,
      extracted: row?.extracted ?? false,
      chunks: chunkCount.all,
      visionChunks: chunkCount.vision,
      vision: row?.vision == null ? null : Boolean(row.vision),
      indexedAt: row?.indexedAt ? new Date(row.indexedAt).toISOString() : null
    })
  }

  // sync metadata for files that no longer exist on disk
  for (const row of dbFiles) {
    if (diskIds.has(row.id)) continue
    const chunkCount = counts.get(row.id) ?? { all: 0, vision: 0 }
    result.push({
      id: row.id,
      dir: row.dir,
      filename: row.filename,
      mime: row.mime,
      size: row.size,
      status: 'missing',
      extracted: row.extracted,
      chunks: chunkCount.all,
      visionChunks: chunkCount.vision,
      vision: row.vision == null ? null : Boolean(row.vision),
      indexedAt: row.indexedAt ? new Date(row.indexedAt).toISOString() : null
    })
  }

  result.sort((a, b) => (a.dir + '/' + a.filename).localeCompare(b.dir + '/' + b.filename))
  return { pages: pagesSummary, globalVision: pdfVisionEnabled(), files: result }
})