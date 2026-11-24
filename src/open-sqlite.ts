import { openNodeSql } from './node-sql.js'
import { SqliteStore } from './sqlite-store.js'

export function openSqliteStore(filename: string, options?: { maxAttempts?: number }): SqliteStore {
  return new SqliteStore(openNodeSql(filename), options)
}
