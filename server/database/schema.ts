import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
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
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
})