import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from '../database/schema'

export const tables = schema

let _db: ReturnType<typeof drizzle> | null = null

export function useDb() {
  if (_db) return _db
  const config = useRuntimeConfig()
  const dbPath = path.resolve(config.dataDir, 'app.db')
  mkdirSync(path.dirname(dbPath), { recursive: true })
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  _db = drizzle(sqlite, { schema })

  // auto-apply migrations when running from the repo (dev / docker volume)
  const migrationsFolder = path.resolve('server/database/migrations')
  if (existsSync(migrationsFolder)) {
    try {
      migrate(_db, { migrationsFolder })
    } catch (error) {
      console.error('[smaki] database migration failed:', error)
    }
  }
  return _db
}