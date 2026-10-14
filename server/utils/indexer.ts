import crypto from 'node:crypto'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { CHUNKS_COLLECTION, PAGES_COLLECTION } from './bootstrap'
import { contentRoot, pagePlainText, walkContent, type PageMeta } from './content'
import { tables, useDb } from './db'
import { chunkText, extractTextFromFile, mimeFor } from './text'
import { describePdf, pdfVisionEnabled, type PdfPageDescription } from './vision'

function md5(input: string | Buffer): string {
  return crypto.createHash('md5').update(input).digest('hex')
}

export function pageHash(p: PageMeta): string {
  return md5([p.title, p.description ?? '', p.markdown].join('\n---\n'))
}

/** index a single page into typesense + record sync state in sqlite */
export async function indexPage(p: PageMeta): Promise<void> {
  const db = useDb()
  const client = useTypesense()
  const text = pagePlainText(p)
  const doc = {
    id: md5(p.path),
    path: p.path,
    title: p.title,
    description: p.description ?? '',
    content: text.slice(0, 20000)
  }
  await client.collections(PAGES_COLLECTION).documents().import([doc as never], { action: 'upsert' })
  const hash = pageHash(p)
  db.insert(tables.pages)
    .values({ path: p.path, hash, indexedAt: new Date() })
    .onConflictDoUpdate({ target: tables.pages.path, set: { hash, indexedAt: new Date() } })
    .run()
}

export async function deletePageDoc(pagePath: string): Promise<void> {
  const db = useDb()
  await useTypesense()
    .collections(PAGES_COLLECTION)
    .documents(md5(pagePath) as never)
    .delete()
    .catch(() => {})
  db.delete(tables.pages)
    .where(eq(tables.pages.path, pagePath))
    .run()
}

interface BuiltChunk {
  content: string
  kind: 'text' | 'vision'
  page?: number
}

/** cached VLM descriptions for this file version, or null when not cached */
function cachedDescriptions(fileId: string, hash: string): PdfPageDescription[] | null {
  const row = useDb()
    .select()
    .from(tables.visionDescriptions)
    .where(eq(tables.visionDescriptions.file_id, fileId))
    .get()
  if (!row || row.hash !== hash) return null
  try {
    return JSON.parse(row.pages) as PdfPageDescription[]
  } catch {
    return null
  }
}

function cacheDescriptions(fileId: string, hash: string, pages: PdfPageDescription[]): void {
  const db = useDb()
  const row = { file_id: fileId, hash, pages: JSON.stringify(pages) }
  db.insert(tables.visionDescriptions)
    .values(row)
    .onConflictDoUpdate({ target: tables.visionDescriptions.file_id, set: row })
    .run()
}

/** extract text from a content file, chunk it and index the chunks into typesense */
export async function indexFile(
  rel: string,
  onProgress?: (message: string) => void
) {
  const db = useDb()
  const client = useTypesense()
  const abs = contentRoot() + '/' + rel
  const buffer = await fsp.readFile(abs)
  const hash = md5(buffer)
  const filename = path.basename(rel)
  const dir = path.dirname(rel) === '.' ? '' : path.dirname(rel)
  const id = md5(rel)
  const existing = db.select().from(tables.files).where(eq(tables.files.id, id)).get()

  const text = await extractTextFromFile(buffer, filename)
  const chunks: BuiltChunk[] = (text.trim() ? chunkText(text) : []).map(content => ({
    content,
    kind: 'text' as const
  }))

  // per-document override of the global pdf vision setting
  const visionOn =
    existing?.vision === 1 || (existing?.vision == null && pdfVisionEnabled())
  if (visionOn && path.extname(filename).toLowerCase() === '.pdf') {
    try {
      let descriptions = cachedDescriptions(id, hash)
      if (!descriptions) {
        const maxPages = Number(useRuntimeConfig().pdfVisionMaxPages) || 20
        descriptions = await describePdf(buffer, maxPages, (page, total) =>
          onProgress?.(`describing page ${page}/${total}`)
        )
        cacheDescriptions(id, hash, descriptions)
      }
      for (const d of descriptions) {
        chunks.push({ content: `Page ${d.page} (visual content): ${d.description}`, kind: 'vision', page: d.page })
      }
    } catch (error) {
      console.error('[smaki] PDF vision indexing failed for', rel, error)
    }
  }
  if (!chunks.length) chunks.push({ content: filename, kind: 'text' })

  // persist the chunks (source of truth for the chunk viewers)
  db.delete(tables.fileChunks).where(eq(tables.fileChunks.file_id, id)).run()
  db.insert(tables.fileChunks)
    .values(
      chunks.map((chunk, i) => ({
        id: md5(`${id}:${i}`),
        file_id: id,
        chunk_index: i,
        content: chunk.content,
        kind: chunk.kind,
        page: chunk.page ?? null
      }))
    )
    .run()

  await client
    .collections(CHUNKS_COLLECTION)
    .documents()
    .delete({ filter_by: `file_id:=${id}` } as never)
    .catch(() => {})

  const docs = chunks.map((chunk, i) => ({
    id: md5(`${id}:${i}`),
    file_id: id,
    page_path: dir,
    filename,
    chunk_index: i,
    content: chunk.content.slice(0, 8000)
  }))
  if (docs.length) {
    await client
      .collections(CHUNKS_COLLECTION)
      .documents()
      .import(docs as never, { action: 'upsert' })
  }

  const row = {
    id,
    dir,
    filename,
    mime: mimeFor(filename),
    size: buffer.length,
    hash,
    extracted: text.trim().length > 0,
    vision: existing?.vision ?? null,
    indexedAt: new Date()
  }
  db.insert(tables.files)
    .values(row)
    .onConflictDoUpdate({ target: tables.files.id, set: row })
    .run()
  return row
}

/** delete chunks + db rows + the file on disk */
export async function removeFile(rel: string): Promise<void> {
  const db = useDb()
  const id = md5(rel)
  await useTypesense()
    .collections(CHUNKS_COLLECTION)
    .documents()
    .delete({ filter_by: `file_id:=${id}` } as never)
    .catch(() => {})
  db.delete(tables.files).where(eq(tables.files.id, id)).run()
  db.delete(tables.fileChunks).where(eq(tables.fileChunks.file_id, id)).run()
  db.delete(tables.visionDescriptions).where(eq(tables.visionDescriptions.file_id, id)).run()
  await fsp.rm(path.join(contentRoot(), rel), { force: true }).catch(() => {})
}

export interface SyncStats {
  pagesIndexed: number
  pagesDeleted: number
  filesIndexed: number
  filesDeleted: number
}

/**
 * full diff sync: walk the content dir, compare hashes with sqlite,
 * upsert changed pages/files in typesense, drop removed ones.
 * `forceAll` reindexes every file (full reindex) while keeping the
 * files table (per-document vision flags) intact.
 */
export async function syncAll(forceAll = false): Promise<SyncStats> {
  const db = useDb()
  const { pages, files } = await walkContent()

  // --- pages ---
  const dbPages = db.select().from(tables.pages).all()
  const dbPageMap = new Map(dbPages.map(r => [r.path, r]))
  let pagesIndexed = 0
  for (const p of pages) {
    if (dbPageMap.get(p.path)?.hash !== pageHash(p)) {
      await indexPage(p)
      pagesIndexed++
    }
  }
  const fsPaths = new Set(pages.map(p => p.path))
  let pagesDeleted = 0
  for (const row of dbPages) {
    if (!fsPaths.has(row.path)) {
      await deletePageDoc(row.path)
      pagesDeleted++
    }
  }

  // --- files ---
  const dbFiles = db.select().from(tables.files).all()
  const dbFileMap = new Map(dbFiles.map(r => [r.id, r]))
  // files indexed before the chunk store existed have typesense chunks but no
  // `file_chunks` rows — reindex them so the chunk viewers have content
  const chunkedIds = new Set(
    db.select({ file_id: tables.fileChunks.file_id }).from(tables.fileChunks).all().map(r => r.file_id)
  )
  const fsRels = new Set(files.map(f => f.rel))
  let filesDeleted = 0
  for (const row of dbFiles) {
    const rel = row.dir ? `${row.dir}/${row.filename}` : row.filename
    if (!fsRels.has(rel)) {
      await useTypesense()
        .collections(CHUNKS_COLLECTION)
        .documents()
        .delete({ filter_by: `file_id:=${row.id}` } as never)
        .catch(() => {})
      db.delete(tables.files).where(eq(tables.files.id, row.id)).run()
      db.delete(tables.fileChunks).where(eq(tables.fileChunks.file_id, row.id)).run()
      db.delete(tables.visionDescriptions).where(eq(tables.visionDescriptions.file_id, row.id)).run()
      filesDeleted++
    }
  }

  let filesIndexed = 0
  for (const file of files) {
    const id = md5(file.rel)
    const existing = dbFileMap.get(id)
    if (
      !forceAll &&
      existing &&
      existing.hash === md5(await fsp.readFile(path.join(contentRoot(), file.rel))) &&
      chunkedIds.has(id)
    ) continue
    await indexFile(file.rel)
    filesIndexed++
  }

  return { pagesIndexed, pagesDeleted, filesIndexed, filesDeleted }
}

/**
 * forced full reindex: drop both wiki collections and rebuild everything from
 * disk. Keeps the files table (per-document vision flags) and the cached VLM
 * descriptions — only chunks and embeddings are rebuilt.
 */
export async function fullReindex(): Promise<SyncStats> {
  const db = useDb()
  const client = useTypesense()
  for (const collection of [PAGES_COLLECTION, CHUNKS_COLLECTION]) {
    await client.collections(collection).delete().catch(() => {})
  }
  db.delete(tables.pages).run()
  db.delete(tables.fileChunks).run()
  await ensureTypesense()
  return await syncAll(true)
}