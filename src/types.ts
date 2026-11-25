import type { TaskSize } from './task-size.js'

export const PROVIDERS = ['anthropic', 'openai', 'xai', 'google'] as const

export type ProviderId = (typeof PROVIDERS)[number]

export function isProviderId(value: string | null | undefined): value is ProviderId {
  return value != null && (PROVIDERS as readonly string[]).includes(value)
}

export type TaskState = 'blocked' | 'open' | 'claimed' | 'running' | 'review' | 'done' | 'failed'

export type DonorKind = 'key' | 'mcp'

export type Logger = {
  info(message: string): void
  error(message: string): void
}

export type CompleteRequest = {
  model: string
  prompt: string
  maxTokens: number
}

export type CompleteResult = {
  text: string
}

export type KeyValidation = { ok: true } | { ok: false; reason: string }

export interface AiProvider {
  readonly id: ProviderId
  validateKey(apiKey: string): Promise<KeyValidation>
  complete(apiKey: string, request: CompleteRequest): Promise<CompleteResult>
}

export type ProjectRecord = {
  id: string
  name: string
  github: string | null
  orgUrl: string | null
  nonprofit: boolean
  repoPath: string
  agentsMd: string | null
  registeredAt: number
  checks: { setup?: string; run: string } | null
  cause: string | null
  summary: string | null
  previewUrl: string | null
  volunteerReviewers: boolean
}

export type TaskRecord = {
  id: string
  projectId: string
  localId: string
  kind: 'code' | 'writing'
  needsComputer: boolean
  // Set when a routine took the task off the board (e.g. handed back 3 times)
  pausedReason: string | null
  // Set after a reviewer asked for changes: the open pull request to continue,
  // and who may revise it first (until revisionUntil).
  revisionPr: string | null
  revisionDonor: string | null
  revisionUntil: number | null
  revisionFeedback: string | null
  // The GitHub issue the task came from, if any
  issueNumber: number | null
  title: string
  goal: string
  instructions: string
  acceptance: string
  tests: string
  scopeDo: string[]
  scopeDont: string[]
  deliverable: string
  size: TaskSize
  providerOverride: ProviderId | null
  estimatedCostUsd: number
  state: TaskState
  donorId: string | null
  leaseUntil: number | null
  attempts: number
  result: string | null
  failureReason: string | null
  reservedCostUsd: number
  budgetPeriod: string | null
  submissionSummary: string | null
  submissionUrl: string | null
  submissionPatch: string | null
  safetyStatus: 'clear' | 'flagged' | 'approved'
  safetyFlags: string[]
  createdAt: number
  updatedAt: number
}

export type DonorRecord = {
  id: string
  name: string
  handle: string
  kind: DonorKind
  provider: ProviderId | null
  spendingCapUsd: number
  spentUsd: number
  reservedUsd: number
  monthlyTaskBudget: number | null
  spentTasks: number
  reservedTasks: number
  budgetPeriod: string
  termsAcceptedAt: number
  keyValidatedAt: number
  createdAt: number
}

export type DonorPublic = {
  id: string
  name: string
  handle: string
  kind: DonorKind
  provider: ProviderId | null
  spendingCapUsd: number
  spentUsd: number
  reservedUsd: number
  monthlyTaskBudget: number | null
  spentTasks: number
  reservedTasks: number
  budgetPeriod: string
  termsAcceptedAt: number
}

export type RegisteredProject = {
  id: string
  name: string
  nonprofit: boolean
  tasks: { id: string; localId: string; state: TaskState; safetyStatus: 'clear' | 'flagged' | 'approved'; safetyFlags: string[] }[]
}

export type ClaimResult =
  | { ok: true; taskId: string; localId: string; projectId: string; leaseUntil: number }
  | { ok: false; reason: string }

export type RunResult =
  | { ok: true; status: 'done'; taskId: string; output: string }
  | { ok: false; status: 'failed'; taskId: string; reason: string }
  | { ok: false; status: 'not_run'; taskId: string; reason: string }

export class BrokerError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'BrokerError'
    this.code = code
  }
}
