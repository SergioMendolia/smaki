import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('member'), // 'admin' | 'member'
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
})

export const sessions = sqliteTable('sessions', {
  token: text('token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull()
})

/** index-sync metadata for content pages (the content itself lives in the .md files) */
export const pages = sqliteTable('pages', {
  path: text('path').primaryKey(),
  hash: text('hash').notNull(),
  indexedAt: integer('indexed_at', { mode: 'timestamp_ms' }).notNull()
})

/** files on disk (documents), chunked into typesense; located by their folder */
export const files = sqliteTable('files', {
  id: text('id').primaryKey(), // md5 of the relative content path
  dir: text('dir').notNull(), // relative folder inside content/
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  hash: text('hash').notNull(),
  extracted: integer('extracted', { mode: 'boolean' }).notNull().default(false),
  /** null = follow NUXT_PDF_VISION, 1 = force pdf vision on, 0 = force off */
  vision: integer('vision'),
  indexedAt: integer('indexed_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
})

/** the chunks indexed for a file (rebuilt on reindex; the search truth lives in typesense) */
export const fileChunks = sqliteTable('file_chunks', {
  id: text('id').primaryKey(), // md5 of `${fileId}:${chunkIndex}`
  file_id: text('file_id').notNull(),
  chunk_index: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  /** 'text' (extracted layer) or 'vision' (VLM page description) */
  kind: text('kind').notNull(),
  /** pdf page number, vision chunks only */
  page: integer('page'),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
})

/** cache of expensive VLM page descriptions, reused across reindexes while the file is unchanged */
export const visionDescriptions = sqliteTable('vision_descriptions', {
  file_id: text('file_id').primaryKey(),
  hash: text('hash').notNull(),
  pages: text('pages').notNull(), // JSON: [{ page, description }]
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
})