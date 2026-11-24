import { describe, expect, it } from 'vitest'

import { checkEligibility, type EligibilityInput } from '../src/eligibility.js'

function input(patch: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    purpose: 'register',
    termsAcceptedAt: 10,
    spendingCapUsd: 5,
    spentUsd: 0,
    reservedUsd: 0,
    provider: 'anthropic',
    apiKey: 'sk-ant-api03-valid-key-value',
    providerKeyChecked: true,
    keyValid: true,
    ...patch,
  }
}

describe('donor eligibility', () => {
  it('accepts a donor who agreed, named a cap, and has a valid key', () => {
    expect(checkEligibility(input())).toEqual({ ok: true })
  })

  it('reports every broken registration rule', () => {
    const result = checkEligibility(
      input({
        termsAcceptedAt: null,
        spendingCapUsd: 0,
        provider: 'local',
        apiKey: 'short',
        keyValid: false,
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons).toEqual([
      'terms_not_accepted',
      'spending_cap_invalid',
      'provider_unsupported',
      'api_key_malformed',
    ])
  })

  it('does not call a key rejected until the provider has been asked', () => {
    const skipped = checkEligibility(input({ providerKeyChecked: false, keyValid: false, apiKey: null }))
    expect(skipped.ok).toBe(false)
    if (skipped.ok) return
    expect(skipped.reasons).toEqual(['api_key_missing'])
  })

  it('rejects a claim that would pass the spending cap', () => {
    const result = checkEligibility(
      input({
        purpose: 'claim',
        spentUsd: 4,
        reservedUsd: 0.5,
        taskCostUsd: 1,
        apiKey: undefined,
      }),
    )
    expect(result).toEqual({ ok: false, reasons: ['spending_cap_exceeded'] })
  })

  it('rejects a missing cap and a key the provider refused', () => {
    expect(checkEligibility(input({ spendingCapUsd: null })).ok).toBe(false)
    expect(checkEligibility(input({ keyValid: false }))).toEqual({ ok: false, reasons: ['api_key_rejected'] })
  })
})
