import type { TaskState } from './types.js'

// Task lifecycle. This is the only place a task changes state.
//
//   blocked --dependencies_met--> open
//   open --claim--> claimed
//   open --dependencies_unmet--> blocked
//   claimed --start--> running
//   claimed --lease_expired | release--> open
//   claimed --submit--> review
//   review --accept--> done
//   review --reject--> open
//   running --succeed--> done
//   running --fail--> failed
//   running --lease_expired | release--> open
//   failed --retry--> open     (deps done, attempts left)
//   failed --retry--> blocked  (deps not done, attempts left)

export type TaskSnapshot = {
  state: TaskState
  donorId: string | null
  leaseUntil: number | null
  attempts: number
  result: string | null
  failureReason: string | null
  reservedCostUsd: number
}

export type ReservationEffect =
  | { type: 'none' }
  | { type: 'hold'; donorId: string; amount: number }
  | { type: 'release'; donorId: string; amount: number }
  | { type: 'charge'; donorId: string; amount: number }

export type TaskEvent =
  | { type: 'dependencies_met' }
  | { type: 'dependencies_unmet' }
  | { type: 'claim'; donorId: string; leaseUntil: number; reservedCostUsd: number }
  | { type: 'start'; donorId: string; leaseUntil: number }
  | { type: 'succeed'; donorId: string; result: string }
  | { type: 'fail'; donorId: string; reason: string; result: string | null }
  | { type: 'lease_expired'; now: number }
  | { type: 'release'; donorId: string; reason?: string }
  | { type: 'submit'; donorId: string }
  | { type: 'accept' }
  | { type: 'reject'; reason: string }
  | { type: 'retry'; depsDone: boolean }

export type TransitionError =
  | 'illegal_transition'
  | 'blocked'
  | 'not_open'
  | 'not_claimed'
  | 'not_running'
  | 'not_leased'
  | 'lease_active'
  | 'donor_mismatch'
  | 'not_failed'
  | 'not_review'
  | 'attempts_exhausted'

export type TransitionResult =
  | { ok: true; task: TaskSnapshot; reservation: ReservationEffect }
  | { ok: false; error: TransitionError }

export type TransitionLimits = {
  maxAttempts: number
}

const FAILURE_REASON_MAX = 500

export function initialTaskState(hasUnmetDependencies: boolean): 'blocked' | 'open' {
  return hasUnmetDependencies ? 'blocked' : 'open'
}

export function transition(
  task: TaskSnapshot,
  event: TaskEvent,
  limits: TransitionLimits,
): TransitionResult {
  switch (event.type) {
    case 'dependencies_met':
      if (task.state !== 'blocked') return reject('illegal_transition')
      return accept(task, { state: 'open' }, { type: 'none' })

    case 'dependencies_unmet':
      if (task.state !== 'open') return reject('illegal_transition')
      return accept(task, { state: 'blocked', donorId: null, leaseUntil: null }, { type: 'none' })

    case 'claim':
      if (task.state === 'blocked') return reject('blocked')
      if (task.state !== 'open') return reject('not_open')
      return accept(
        task,
        {
          state: 'claimed',
          donorId: event.donorId,
          leaseUntil: event.leaseUntil,
          result: null,
          failureReason: null,
          reservedCostUsd: event.reservedCostUsd,
        },
        { type: 'hold', donorId: event.donorId, amount: event.reservedCostUsd },
      )

    case 'start':
      if (task.state !== 'claimed') return reject('not_claimed')
      if (task.donorId !== event.donorId) return reject('donor_mismatch')
      return accept(task, { state: 'running', leaseUntil: event.leaseUntil }, { type: 'none' })

    case 'succeed':
      if (task.state !== 'running') return reject('not_running')
      if (task.donorId !== event.donorId) return reject('donor_mismatch')
      return accept(
        task,
        { state: 'done', leaseUntil: null, result: event.result, failureReason: null, reservedCostUsd: 0 },
        charge(task),
      )

    case 'fail':
      if (task.state !== 'running') return reject('not_running')
      if (task.donorId !== event.donorId) return reject('donor_mismatch')
      return accept(
        task,
        {
          state: 'failed',
          leaseUntil: null,
          attempts: task.attempts + 1,
          result: event.result,
          failureReason: event.reason.slice(0, FAILURE_REASON_MAX),
          reservedCostUsd: 0,
        },
        release(task),
      )

    case 'lease_expired':
      if (task.state !== 'claimed' && task.state !== 'running') return reject('not_leased')
      if (task.leaseUntil == null || task.leaseUntil > event.now) return reject('lease_active')
      return accept(
        task,
        { state: 'open', donorId: null, leaseUntil: null, result: null, failureReason: null, reservedCostUsd: 0 },
        release(task),
      )

    case 'release':
      if (task.state !== 'claimed' && task.state !== 'running') return reject('not_leased')
      if (task.donorId !== event.donorId) return reject('donor_mismatch')
      return accept(
        task,
        {
          state: 'open',
          donorId: null,
          leaseUntil: null,
          result: null,
          failureReason: event.reason ? event.reason.slice(0, FAILURE_REASON_MAX) : null,
          reservedCostUsd: 0,
        },
        release(task),
      )

    case 'submit':
      if (task.state !== 'claimed') return reject('not_claimed')
      if (task.donorId !== event.donorId) return reject('donor_mismatch')
      return accept(task, { state: 'review', leaseUntil: null }, { type: 'none' })

    case 'accept':
      if (task.state !== 'review') return reject('not_review')
      return accept(
        task,
        { state: 'done', leaseUntil: null, failureReason: null, reservedCostUsd: 0 },
        charge(task),
      )

    case 'reject':
      if (task.state !== 'review') return reject('not_review')
      return accept(
        task,
        {
          state: 'open',
          donorId: null,
          leaseUntil: null,
          result: null,
          failureReason: event.reason.slice(0, FAILURE_REASON_MAX),
          reservedCostUsd: 0,
        },
        release(task),
      )

    case 'retry':
      if (task.state !== 'failed') return reject('not_failed')
      if (task.attempts >= limits.maxAttempts) return reject('attempts_exhausted')
      return accept(
        task,
        {
          state: event.depsDone ? 'open' : 'blocked',
          donorId: null,
          leaseUntil: null,
          result: null,
          failureReason: null,
          reservedCostUsd: 0,
        },
        { type: 'none' },
      )

    default: {
      const unreachable: never = event
      void unreachable
      return reject('illegal_transition')
    }
  }
}

function accept(
  task: TaskSnapshot,
  patch: Partial<TaskSnapshot>,
  reservation: ReservationEffect,
): TransitionResult {
  return { ok: true, task: { ...task, ...patch }, reservation }
}

function reject(error: TransitionError): TransitionResult {
  return { ok: false, error }
}

function release(task: TaskSnapshot): ReservationEffect {
  if (!task.donorId || task.reservedCostUsd <= 0) return { type: 'none' }
  return { type: 'release', donorId: task.donorId, amount: task.reservedCostUsd }
}

function charge(task: TaskSnapshot): ReservationEffect {
  if (!task.donorId || task.reservedCostUsd <= 0) return { type: 'none' }
  return { type: 'charge', donorId: task.donorId, amount: task.reservedCostUsd }
}
