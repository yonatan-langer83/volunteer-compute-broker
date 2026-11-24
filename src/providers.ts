import type { AiProvider, KeyValidation, ProviderId } from './types.js'
import { redact } from './redact.js'

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-4.1-mini',
  xai: 'grok-3',
  google: 'gemini-2.5-flash',
}

export function defaultModel(id: ProviderId): string {
  const override = process.env[`BROKER_MODEL_${id.toUpperCase()}`]
  return override && override.length > 0 ? override : DEFAULT_MODELS[id]
}

export class ProviderRegistry {
  private readonly byId: Map<ProviderId, AiProvider>

  constructor(providers: AiProvider[]) {
    this.byId = new Map(providers.map((provider) => [provider.id, provider]))
  }

  get(id: ProviderId): AiProvider | null {
    return this.byId.get(id) ?? null
  }
}

export function createProviderRegistry(fetchImpl: typeof fetch = fetch): ProviderRegistry {
  return new ProviderRegistry([
    createAnthropicProvider(fetchImpl),
    createChatProvider({
      id: 'openai',
      origin: 'https://api.openai.com/v1',
      tokenField: 'max_completion_tokens',
      fetchImpl,
    }),
    createChatProvider({
      id: 'xai',
      origin: 'https://api.x.ai/v1',
      tokenField: 'max_tokens',
      fetchImpl,
    }),
    createGoogleProvider(fetchImpl),
  ])
}

export function createAnthropicProvider(fetchImpl: typeof fetch = fetch): AiProvider {
  return {
    id: 'anthropic',
    validateKey: (apiKey) =>
      authorized(fetchImpl, apiKey, 'https://api.anthropic.com/v1/models', {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      }),
    complete: async (apiKey, request) => {
      const response = await send(
        fetchImpl,
        apiKey,
        'https://api.anthropic.com/v1/messages',
        {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        {
          model: request.model,
          max_tokens: request.maxTokens,
          messages: [{ role: 'user', content: request.prompt }],
        },
      )
      const body = await readJson(response, apiKey)
      const content = asRecord(body).content
      if (!Array.isArray(content)) throw providerError('anthropic', 'response missing content', apiKey)
      const text = content
        .map((block) => (isRecord(block) && typeof block.text === 'string' ? block.text : ''))
        .join('')
      if (text.length === 0) throw providerError('anthropic', 'response missing text', apiKey)
      return { text }
    },
  }
}

function createChatProvider(options: {
  id: 'openai' | 'xai'
  origin: string
  tokenField: 'max_tokens' | 'max_completion_tokens'
  fetchImpl: typeof fetch
}): AiProvider {
  return {
    id: options.id,
    validateKey: (apiKey) =>
      authorized(options.fetchImpl, apiKey, `${options.origin}/models`, {
        authorization: `Bearer ${apiKey}`,
      }),
    complete: async (apiKey, request) => {
      const response = await send(
        options.fetchImpl,
        apiKey,
        `${options.origin}/chat/completions`,
        {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        {
          model: request.model,
          [options.tokenField]: request.maxTokens,
          messages: [{ role: 'user', content: request.prompt }],
        },
      )
      const body = await readJson(response, apiKey)
      const choices = asRecord(body).choices
      const first = Array.isArray(choices) ? choices[0] : undefined
      const message = isRecord(first) ? first.message : undefined
      const text = isRecord(message) && typeof message.content === 'string' ? message.content : ''
      if (text.length === 0) throw providerError(options.id, 'response missing text', apiKey)
      return { text }
    },
  }
}

export function createGoogleProvider(fetchImpl: typeof fetch = fetch): AiProvider {
  const root = 'https://generativelanguage.googleapis.com/v1beta'
  return {
    id: 'google',
    validateKey: (apiKey) =>
      authorized(fetchImpl, apiKey, `${root}/models?pageSize=1`, {
        'x-goog-api-key': apiKey,
      }),
    complete: async (apiKey, request) => {
      const url = `${root}/models/${encodeURIComponent(request.model)}:generateContent`
      const response = await send(
        fetchImpl,
        apiKey,
        url,
        {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        {
          contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
          generationConfig: { maxOutputTokens: request.maxTokens },
        },
      )
      const body = await readJson(response, apiKey)
      const candidates = asRecord(body).candidates
      const first = Array.isArray(candidates) ? candidates[0] : undefined
      const content = isRecord(first) ? first.content : undefined
      const parts = isRecord(content) && Array.isArray(content.parts) ? content.parts : []
      const text = parts
        .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
        .join('')
      if (text.length === 0) throw providerError('google', 'response missing text', apiKey)
      return { text }
    },
  }
}

async function authorized(
  fetchImpl: typeof fetch,
  apiKey: string,
  url: string,
  headers: Record<string, string>,
): Promise<KeyValidation> {
  try {
    const response = await fetchImpl(url, { method: 'GET', headers, signal: AbortSignal.timeout(20_000) })
    if (response.ok) {
      await response.arrayBuffer()
      return { ok: true }
    }
    const detail = redact(await response.text(), [apiKey]).slice(0, 200)
    return { ok: false, reason: `HTTP ${response.status} ${detail}` }
  } catch (error) {
    return { ok: false, reason: redact(error instanceof Error ? error.message : 'request failed', [apiKey]) }
  }
}

async function send(
  fetchImpl: typeof fetch,
  apiKey: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Response> {
  if (url.includes(apiKey)) throw providerError('provider', 'refusing to send the key in a URL', apiKey)
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
  } catch (error) {
    throw providerError('provider', error instanceof Error ? error.message : 'request failed', apiKey)
  }
  if (!response.ok) {
    const detail = redact(await response.text(), [apiKey]).slice(0, 300)
    throw providerError('provider', `HTTP ${response.status} ${detail}`, apiKey)
  }
  return response
}

async function readJson(response: Response, apiKey: string): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw providerError('provider', 'response was not JSON', apiKey)
  }
}

function providerError(who: string, message: string, apiKey: string): Error {
  return new Error(redact(`${who}: ${message}`, [apiKey]))
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
