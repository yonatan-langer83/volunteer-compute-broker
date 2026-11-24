import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

import type { Broker } from './broker.js'
import { createMcpServer } from './mcp-tools.js'
import { redact } from './redact.js'
import type { Logger } from './types.js'

export { createMcpServer } from './mcp-tools.js'

export async function startMcpHttpServer(options: {
  broker: Broker
  port: number
  host?: string
  logger?: Logger
}): Promise<{ url: string; close: () => Promise<void> }> {
  const logger = options.logger ?? { info() {}, error() {} }
  const server = createServer((req, res) => {
    void handleHttp(options.broker, logger, req, res)
  })
  await new Promise<void>((resolve) => server.listen(options.port, options.host ?? '127.0.0.1', () => resolve()))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : options.port
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

export async function serveMcpStdio(broker: Broker, token: string): Promise<void> {
  const donorId = await broker.authenticateMcpToken(token)
  if (!donorId) {
    process.stderr.write('MCP token was refused\n')
    process.exitCode = 1
    return
  }
  const mcp = createMcpServer(broker, () => donorId)
  await mcp.connect(new StdioServerTransport())
}

async function handleHttp(broker: Broker, logger: Logger, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.url?.split('?')[0] !== '/mcp') {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not_found' }))
    return
  }
  if (req.method === 'GET' || req.method === 'DELETE') {
    res.writeHead(405, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'method_not_allowed' }))
    return
  }
  const header = req.headers.authorization
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  const donorId = token ? await broker.authenticateMcpToken(token) : null
  if (!donorId) {
    logger.error('MCP request refused')
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'unauthorized' }))
    return
  }
  try {
    const body = await readJson(req)
    const mcp = createMcpServer(broker, () => donorId)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await mcp.connect(transport)
    await transport.handleRequest(req, res, body)
    await mcp.close()
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : 'request failed')
    logger.error(message)
    if (!res.headersSent) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: message }))
    }
  }
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1_000_000) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('body was not JSON'))
      }
    })
    req.on('error', reject)
  })
}
