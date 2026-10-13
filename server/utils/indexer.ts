import crypto from 'node:crypto'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { CHUNKS_COLLECTION, PAGES_COLLECTION } from './bootstrap'
import { contentRoot, pagePlainText, walkContent, type PageMeta } from './content'
import { tables, useDb } from './db'
import { chunkText, extractTextFromFile, mimeFor } from './text'

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

/** extract text from a content file, chunk it and index the chunks into typesense */
export async function indexFile(rel: string) {
  const db = useDb()
  const client = useTypesense()
  const abs = contentRoot() + '/' + rel
  const buffer = await fsp.readFile(abs)
  const hash = md5(buffer)
  const filename = path.basename(rel)
  const dir = path.dirname(rel) === '.' ? '' : path.dirname(rel)
  const text = await extractTextFromFile(buffer, filename)
  const chunks = text.trim() ? chunkText(text) : [filename]
  const id = md5(rel)

  await client
    .collections(CHUNKS_COLLECTION)
    .documents()
    .delete({ filter_by: `file_id:=${id}` } as never)
    .catch(() => {})

  const docs = chunks.map((content, i) => ({
    id: md5(`${id}:${i}`),
    file_id: id,
    page_path: dir,
    filename,
    chunk_index: i,
    content: content.slice(0, 8000)
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
    extracted: text.trim().length > 0
  }
  db.insert(tables.files)
    .values(row)
    .onConflictDoUpdate({ target: tables.files.id, set: row })
    .run()
  return row
}

/** delete chunks + db row + the file on disk */
export async function removeFile(rel: string): Promise<void> {
  const db = useDb()
  const id = md5(rel)
  await useTypesense()
    .collections(CHUNKS_COLLECTION)
    .documents()
    .delete({ filter_by: `file_id:=${id}` } as never)
    .catch(() => {})
  db.delete(tables.files)
    .where(eq(tables.files.id, id))
    .run()
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
 */
export async function syncAll(): Promise<SyncStats> {
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
      db.delete(tables.files)
        .where(eq(tables.files.id, row.id))
        .run()
      filesDeleted++
    }
  }

  let filesIndexed = 0
  for (const file of files) {
    const id = md5(file.rel)
    const existing = dbFileMap.get(id)
    const fileHash = md5(await fsp.readFile(path.join(contentRoot(), file.rel)))
    if (existing && existing.hash === fileHash) continue
    await indexFile(file.rel)
    filesIndexed++
  }

  return { pagesIndexed, pagesDeleted, filesIndexed, filesDeleted }
}

/**
 * forced full reindex: drop both wiki collections and all sync metadata,
 * then recreate (with the current embedding config) and rebuild from disk.
 */
export async function fullReindex(): Promise<SyncStats> {
  const db = useDb()
  const client = useTypesense()
  for (const collection of [PAGES_COLLECTION, CHUNKS_COLLECTION]) {
    await client.collections(collection).delete().catch(() => {})
  }
  db.delete(tables.pages).run()
  db.delete(tables.files).run()
  await ensureTypesense()
  return await syncAll()
}