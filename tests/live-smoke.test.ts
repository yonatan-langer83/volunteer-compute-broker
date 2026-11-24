import { describe, expect, it } from 'vitest'

import { createProviderRegistry, defaultModel } from '../src/providers.js'
import type { ProviderId } from '../src/types.js'

const registry = createProviderRegistry()

const cases: { id: ProviderId; key: string | undefined }[] = [
  { id: 'anthropic', key: process.env.ANTHROPIC_API_KEY },
  { id: 'openai', key: process.env.OPENAI_API_KEY },
  { id: 'xai', key: process.env.XAI_API_KEY },
  { id: 'google', key: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY },
]

describe('live provider smoke', () => {
  for (const entry of cases) {
    it.skipIf(!entry.key)(`completes a tiny prompt with ${entry.id}`, async () => {
      const provider = registry.get(entry.id)
      const apiKey = entry.key
      if (!provider || !apiKey) throw new Error('missing provider')
      const validation = await provider.validateKey(apiKey)
      expect(validation.ok).toBe(true)
      const result = await provider.complete(apiKey, {
        model: defaultModel(entry.id),
        prompt: 'Reply with the single word pong and nothing else.',
        maxTokens: 32,
      })
      expect(result.text.toLowerCase()).toContain('pong')
    }, 45_000)
  }
})
