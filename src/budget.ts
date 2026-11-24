// How a donor meets a task: organization choice, monthly budget, then nonprofit and size.

export type ClaimCandidate = {
  id: string
  estimatedCostUsd: number
  nonprofit: boolean
  createdAt: number
}

export function budgetPeriod(nowMs: number): string {
  const date = new Date(nowMs)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}`
}

export function supportsProject(supportedNames: readonly string[], projectName: string): boolean {
  if (supportedNames.length === 0) return true
  return supportedNames.includes(projectName)
}

export function fitsTaskBudget(monthly: number, spent: number, reserved: number): boolean {
  return Number.isInteger(monthly) && monthly > 0 && spent + reserved + 1 <= monthly
}

export function fitsMonthlyBudget(cost: number, monthly: number, spent: number, reserved: number): boolean {
  return Number.isFinite(cost) && cost > 0 && spent + reserved + cost <= monthly + 1e-9
}

// Nonprofit work comes first. Within that, the largest task that fits comes first.
export function compareClaimable(a: ClaimCandidate, b: ClaimCandidate): number {
  if (a.nonprofit !== b.nonprofit) return a.nonprofit ? -1 : 1
  if (a.estimatedCostUsd !== b.estimatedCostUsd) return b.estimatedCostUsd - a.estimatedCostUsd
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

export type PlacementBlock =
  | { reason: 'no_eligible_donor' }
  | { reason: 'exceeds_every_monthly_budget'; largestBudgetUsd: number }

export function explainTaskFit(input: {
  supportedNames: readonly string[]
  projectName: string
  providerOverride: string | null
  estimatedCostUsd: number
  donor: {
    kind: 'key' | 'mcp'
    provider: string | null
    spendingCapUsd: number
    spentUsd: number
    reservedUsd: number
    monthlyTaskBudget: number | null
    spentTasks: number
    reservedTasks: number
  }
}): string | null {
  if (!supportsProject(input.supportedNames, input.projectName)) return 'project_not_supported'
  // A provider lock applies only to API-key donors. An MCP agent brings its own model.
  if (input.donor.kind === 'mcp') {
    const budget = input.donor.monthlyTaskBudget ?? 0
    if (!fitsTaskBudget(budget, input.donor.spentTasks, input.donor.reservedTasks)) return 'task_budget_exceeded'
    return null
  }
  if (input.providerOverride && input.providerOverride !== input.donor.provider) return 'provider_mismatch'
  if (!fitsMonthlyBudget(input.estimatedCostUsd, input.donor.spendingCapUsd, input.donor.spentUsd, input.donor.reservedUsd)) {
    return 'spending_cap_exceeded'
  }
  return null
}

export function placementBlock(cost: number, monthlyBudgets: readonly number[]): PlacementBlock | null {
  if (monthlyBudgets.length === 0) return { reason: 'no_eligible_donor' }
  let largest = 0
  for (const budget of monthlyBudgets) {
    if (budget > largest) largest = budget
  }
  if (cost > largest + 1e-9) return { reason: 'exceeds_every_monthly_budget', largestBudgetUsd: largest }
  return null
}
