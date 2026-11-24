import { describe, expect, it } from 'vitest'

import { createProviderRegistry } from '../src/providers.js'

const key = 'sk-test-adapter-key-1234567890'

function mockFetch(
  handler: (url: string, init: RequestInit) => { status: number; body: unknown },
): { fetch: typeof fetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const request = init ?? {}
    calls.push({ url, init: request })
    const result = handler(url, request)
    const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body)
    return new Response(body, { status: result.status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { fetch: fetchImpl, calls }
}

function headersOf(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>
}

describe('provider adapters', () => {
  it('calls the Anthropic messages API with the key in a header', async () => {
    const { fetch, calls } = mockFetch((url, init) => {
      if (init.method === 'GET') return { status: 200, body: { data: [] } }
      expect(url).toBe('https://api.anthropic.com/v1/messages')
      const headers = headersOf(init)
      expect(headers['x-api-key']).toBe(key)
      expect(headers['anthropic-version']).toBe('2023-06-01')
      const body = JSON.parse(String(init.body)) as { model: string; max_tokens: number }
      expect(body.model).toBe('claude-sonnet-4-5')
      expect(body.max_tokens).toBe(16)
      return { status: 200, body: { content: [{ type: 'text', text: 'pong' }] } }
    })
    const provider = createProviderRegistry(fetch).get('anthropic')
    if (!provider) throw new Error('missing provider')
    expect(await provider.validateKey(key)).toEqual({ ok: true })
    const result = await provider.complete(key, { model: 'claude-sonnet-4-5', prompt: 'ping', maxTokens: 16 })
    expect(result.text).toBe('pong')
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/models')
  })

  it('calls OpenAI and xAI chat completions on their own hosts', async () => {
    const seen: { host: string; field: string }[] = []
    const { fetch } = mockFetch((url, init) => {
      if (init.method === 'GET') return { status: 200, body: { data: [] } }
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      const field = 'max_completion_tokens' in body ? 'max_completion_tokens' : 'max_tokens'
      seen.push({ host: new URL(url).host, field })
      expect(headersOf(init).authorization).toBe(`Bearer ${key}`)
      return { status: 200, body: { choices: [{ message: { role: 'assistant', content: 'pong' } }] } }
    })
    const registry = createProviderRegistry(fetch)
    const openai = registry.get('openai')
    const xai = registry.get('xai')
    if (!openai || !xai) throw new Error('missing provider')
    await openai.complete(key, { model: 'gpt-4.1-mini', prompt: 'ping', maxTokens: 8 })
    await xai.complete(key, { model: 'grok-3', prompt: 'ping', maxTokens: 8 })
    expect(seen).toEqual([
      { host: 'api.openai.com', field: 'max_completion_tokens' },
      { host: 'api.x.ai', field: 'max_tokens' },
    ])
  })

  it('sends the Google key in a header and never in the URL', async () => {
    const googleKey = 'AIzaSyADAPTERKEY00000000000000000'
    const { fetch, calls } = mockFetch((url, init) => {
      expect(url).not.toContain(googleKey)
      if (init.method === 'GET') return { status: 200, body: { models: [] } }
      expect(headersOf(init)['x-goog-api-key']).toBe(googleKey)
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
      return { status: 200, body: { candidates: [{ content: { parts: [{ text: 'pong' }] } }] } }
    })
    const provider = createProviderRegistry(fetch).get('google')
    if (!provider) throw new Error('missing provider')
    expect((await provider.validateKey(googleKey)).ok).toBe(true)
    expect((await provider.complete(googleKey, { model: 'gemini-2.5-flash', prompt: 'ping', maxTokens: 8 })).text).toBe('pong')
    expect(calls.every((call) => !call.url.includes(googleKey))).toBe(true)
  })

  it('strips the key from provider error bodies', async () => {
    const { fetch } = mockFetch(() => ({ status: 401, body: `unauthorized for ${key}` }))
    const provider = createProviderRegistry(fetch).get('openai')
    if (!provider) throw new Error('missing provider')
    await expect(provider.complete(key, { model: 'gpt-4.1-mini', prompt: 'ping', maxTokens: 8 })).rejects.toThrow(/\[REDACTED\]/)
    await expect(provider.complete(key, { model: 'gpt-4.1-mini', prompt: 'ping', maxTokens: 8 })).rejects.toThrow(
      new RegExp(`^(?!.*${key}).*$`),
    )
  })
})
