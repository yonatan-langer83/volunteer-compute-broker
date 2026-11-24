import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { Sql, SqlValue } from './sql.js'

export function openNodeSql(filename: string): Sql {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true })
  const db = new DatabaseSync(filename)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  if (filename !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  return new NodeSql(db, filename !== ':memory:')
}

class NodeSql implements Sql {
  constructor(
    private readonly db: DatabaseSync,
    private readonly file: boolean,
  ) {}

  async exec(sql: string): Promise<void> {
    this.db.exec(sql)
  }

  async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[]
  }

  async get<T>(sql: string, params: SqlValue[] = []): Promise<T | undefined> {
    return this.db.prepare(sql).get(...params) as T | undefined
  }

  async run(sql: string, params: SqlValue[] = []): Promise<number> {
    return Number(this.db.prepare(sql).run(...params).changes)
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const value = await fn()
      this.db.exec('COMMIT')
      return value
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // The transaction is already closed.
      }
      throw error
    }
  }

  async close(): Promise<void> {
    if (this.file) this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    this.db.close()
  }
}
