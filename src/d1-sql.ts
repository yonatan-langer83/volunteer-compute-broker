import type { Sql, SqlValue } from './sql.js'

type Statement = {
  bind(...params: unknown[]): Statement
  all<T>(): Promise<{ results?: T[] }>
  first<T>(): Promise<T | null>
  run(): Promise<{ meta?: { changes?: number } }>
}

type D1Like = {
  exec(sql: string): Promise<unknown>
  prepare(sql: string): Statement
  batch?(statements: Statement[]): Promise<unknown>
}

// The schema is CREATE ... IF NOT EXISTS only, and production applies it with
// migrations. Run it once per database binding per isolate, in one round trip,
// instead of ~20 sequential statements on every request.
const schemaDone = new WeakSet<object>()

// One Durable Object runs these calls one at a time (worker.ts queues requests). D1 has no interactive
// transaction, so each statement commits on its own. A crash between the task
// update and the budget update can leave those two rows briefly apart. The
// object still finishes one claim before it starts the next, and the claim
// update itself is conditional on state = 'open'.
export class D1Sql implements Sql {
  constructor(private readonly db: D1Like) {}

  async exec(sql: string): Promise<void> {
    if (schemaDone.has(this.db)) return
    const statements = sql
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
    if (this.db.batch) {
      await this.db.batch(statements.map((statement) => this.db.prepare(statement)))
    } else {
      for (const statement of statements) await this.db.prepare(statement).run()
    }
    schemaDone.add(this.db)
  }

  async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const result = await this.statement(sql, params).all<T>()
    return result.results ?? []
  }

  async get<T>(sql: string, params: SqlValue[] = []): Promise<T | undefined> {
    const row = await this.statement(sql, params).first<T>()
    return row ?? undefined
  }

  async run(sql: string, params: SqlValue[] = []): Promise<number> {
    const result = await this.statement(sql, params).run()
    return Number(result.meta?.changes ?? 0)
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn()
  }

  private statement(sql: string, params: SqlValue[]): Statement {
    const prepared = this.db.prepare(sql)
    return params.length === 0 ? prepared : prepared.bind(...params)
  }

  async close(): Promise<void> {}
}
