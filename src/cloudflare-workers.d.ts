declare module 'cloudflare:workers' {
  export class DurableObject<E = unknown> {
    constructor(ctx: unknown, env: E)
    env: E
  }
}
