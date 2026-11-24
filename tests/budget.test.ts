import { describe, expect, it } from 'vitest'

import { budgetPeriod, compareClaimable, fitsMonthlyBudget, placementBlock, supportsProject, type ClaimCandidate } from '../src/budget.js'

function candidate(patch: Partial<ClaimCandidate> & Pick<ClaimCandidate, 'id'>): ClaimCandidate {
  return {
    estimatedCostUsd: 1,
    nonprofit: false,
    createdAt: 1,
    ...patch,
  }
}

describe('monthly budget matching', () => {
  it('uses the UTC calendar month', () => {
    expect(budgetPeriod(Date.UTC(2026, 10, 30, 23, 30))).toBe('2026-11')
    expect(budgetPeriod(Date.UTC(2026, 11, 1, 0, 30))).toBe('2026-12')
  })

  it('puts nonprofit work ahead of a larger commercial task, then prefers the larger fit', () => {
    const tasks = [
      candidate({ id: 'commercial-large', estimatedCostUsd: 0.9, createdAt: 1 }),
      candidate({ id: 'civic-small', estimatedCostUsd: 0.04, nonprofit: true, createdAt: 2 }),
      candidate({ id: 'civic-large', estimatedCostUsd: 0.1, nonprofit: true, createdAt: 3 }),
      candidate({ id: 'commercial-tie', estimatedCostUsd: 0.1, createdAt: 0 }),
    ]
    expect([...tasks].sort(compareClaimable).map((task) => task.id)).toEqual([
      'civic-large',
      'civic-small',
      'commercial-large',
      'commercial-tie',
    ])
  })

  it('lets an empty support list take any project and a named list take only those', () => {
    expect(supportsProject([], 'alpha')).toBe(true)
    expect(supportsProject(['alpha'], 'alpha')).toBe(true)
    expect(supportsProject(['alpha'], 'beta')).toBe(false)
  })

  it('flags a cost no full monthly budget can cover', () => {
    expect(fitsMonthlyBudget(0.04, 0.1, 0.1, 0)).toBe(false)
    expect(fitsMonthlyBudget(0.04, 0.1, 0, 0)).toBe(true)
    expect(placementBlock(50, [0.1, 20])).toEqual({ reason: 'exceeds_every_monthly_budget', largestBudgetUsd: 20 })
    expect(placementBlock(15, [0.1, 20])).toBeNull()
    expect(placementBlock(1, [])).toEqual({ reason: 'no_eligible_donor' })
  })
})