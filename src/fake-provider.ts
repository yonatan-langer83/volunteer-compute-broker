import type { AiProvider, CompleteRequest, CompleteResult, KeyValidation, ProviderId } from './types.js'
import { PROVIDERS } from './types.js'
import { ProviderRegistry } from './providers.js'

export type FakeCall = {
  provider: ProviderId
  apiKey: string
  prompt: string
}

export type FakeHooks = {
  validateKey?: (apiKey: string) => KeyValidation | Promise<KeyValidation>
  complete?: (apiKey: string, request: CompleteRequest) => CompleteResult | Promise<CompleteResult>
  seen?: FakeCall[]
}

export function createFakeProvider(id: ProviderId, hooks: FakeHooks = {}): AiProvider {
  return {
    id,
    async validateKey(apiKey) {
      if (hooks.validateKey) return hooks.validateKey(apiKey)
      if (apiKey.includes('invalid-key')) return { ok: false, reason: 'rejected' }
      return { ok: true }
    },
    async complete(apiKey, request) {
      hooks.seen?.push({ provider: id, apiKey, prompt: request.prompt })
      if (hooks.complete) return hooks.complete(apiKey, request)
      return scriptedComplete(request)
    },
  }
}

export function createFakeRegistry(hooks: Partial<Record<ProviderId, FakeHooks>> = {}): ProviderRegistry {
  return new ProviderRegistry(PROVIDERS.map((id) => createFakeProvider(id, hooks[id] ?? {})))
}

function scriptedComplete(request: CompleteRequest): CompleteResult {
  if (request.prompt.includes('ACCEPTANCE CHECK')) {
    const accepted = !request.prompt.includes('FORCE_REJECT')
    return {
      text: JSON.stringify({
        accepted,
        reason: accepted ? 'meets the criteria' : 'missing required detail',
      }),
    }
  }
  const title = request.prompt.match(/^Task: (.+)$/m)?.[1] ?? 'task'
  return { text: JSON.stringify({ output: `completed: ${title}`, summary: 'ok' }) }
}
