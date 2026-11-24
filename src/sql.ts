export type SqlValue = string | number | null | bigint

export interface Sql {
  exec(sql: string): Promise<void>
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>
  get<T>(sql: string, params?: SqlValue[]): Promise<T | undefined>
  run(sql: string, params?: SqlValue[]): Promise<number>
  transaction<T>(fn: () => Promise<T>): Promise<T>
  close(): Promise<void>
}
