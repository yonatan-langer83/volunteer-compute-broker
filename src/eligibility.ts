import { isProviderId } from './types.js'

// Donor gate. The spending cap is the donor's monthly budget. Spent and reserved
// are the current calendar month. Add new rules here.
export type EligibilityReason =
  | 'terms_not_accepted'
  | 'spending_cap_missing'
  | 'spending_cap_invalid'
  | 'spending_cap_exceeded'
  | 'task_budget_invalid'
  | 'task_budget_exceeded'
  | 'provider_unsupported'
  | 'api_key_missing'
  | 'api_key_malformed'
  | 'api_key_rejected'

export type EligibilityInput = {
  purpose: 'register' | 'claim'
  termsAcceptedAt: number | null
  spendingCapUsd: number | null
  spentUsd: number
  reservedUsd: number
  provider: string | null
  apiKey?: string | null
  providerKeyChecked: boolean
  keyValid?: boolean
  taskCostUsd?: number
  budgetKind?: 'usd' | 'tasks'
  monthlyTaskBudget?: number | null
  spentTasks?: number
  reservedTasks?: number
}

export type EligibilityResult = { ok: true } | { ok: false; reasons: EligibilityReason[] }

export function checkEligibility(input: EligibilityInput): EligibilityResult {
  const reasons: EligibilityReason[] = []

  if (input.termsAcceptedAt == null || !Number.isFinite(input.termsAcceptedAt) || input.termsAcceptedAt <= 0) {
    reasons.push('terms_not_accepted')
  }

  const taskBudget = input.budgetKind === 'tasks'
  if (!taskBudget && input.spendingCapUsd == null) {
    reasons.push('spending_cap_missing')
  } else if (!taskBudget && (input.spendingCapUsd == null || !Number.isFinite(input.spendingCapUsd) || input.spendingCapUsd <= 0)) {
    reasons.push('spending_cap_invalid')
  }
  if (taskBudget) {
    const budget = input.monthlyTaskBudget
    if (budget == null || !Number.isInteger(budget) || budget <= 0) reasons.push('task_budget_invalid')
    if (input.purpose === 'claim' && (input.spentTasks ?? 0) + (input.reservedTasks ?? 0) + 1 > (budget ?? 0)) {
      reasons.push('task_budget_exceeded')
    }
  }

  if (!taskBudget && !isProviderId(input.provider)) {
    reasons.push('provider_unsupported')
  }

  if (!taskBudget && input.purpose === 'register') {
    const keyProblem = classifyApiKey(input.apiKey)
    if (keyProblem) {
      reasons.push(keyProblem)
    } else if (input.providerKeyChecked && input.keyValid !== true) {
      reasons.push('api_key_rejected')
    }
  } else if (!taskBudget && input.keyValid !== true) {
    reasons.push('api_key_rejected')
  }

  const cap = input.spendingCapUsd
  if (!taskBudget && input.purpose === 'claim' && capIsUsable(cap)) {
    const cost = input.taskCostUsd ?? 0
    const spent = input.spentUsd
    const reserved = input.reservedUsd
    if (!Number.isFinite(cost) || cost <= 0 || spent + reserved + cost > cap + 1e-9) {
      reasons.push('spending_cap_exceeded')
    }
  }

  if (reasons.length > 0) return { ok: false, reasons }
  return { ok: true }
}

function capIsUsable(cap: number | null): cap is number {
  return cap != null && Number.isFinite(cap) && cap > 0
}

function classifyApiKey(apiKey: string | null | undefined): EligibilityReason | null {
  if (apiKey == null || apiKey === '') return 'api_key_missing'
  if (apiKey.length < 12 || apiKey.length > 500) return 'api_key_malformed'
  if (/\s/.test(apiKey)) return 'api_key_malformed'
  return null
}
