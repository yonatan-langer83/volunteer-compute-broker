import { describe, expect, it } from 'vitest'

import { initialTaskState, transition, type TaskSnapshot } from '../src/state-machine.js'

const limits = { maxAttempts: 3 }

function task(patch: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return {
    state: 'open',
    donorId: null,
    leaseUntil: null,
    attempts: 0,
    result: null,
    failureReason: null,
    reservedCostUsd: 0,
    ...patch,
  }
}

describe('task state machine', () => {
  it('starts blocked only when dependencies are unmet', () => {
    expect(initialTaskState(false)).toBe('open')
    expect(initialTaskState(true)).toBe('blocked')
  })

  it('walks the happy path and charges the reservation', () => {
    const opened = transition(task({ state: 'blocked' }), { type: 'dependencies_met' }, limits)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.task.state).toBe('open')

    const claimed = transition(
      opened.task,
      { type: 'claim', donorId: 'ada', leaseUntil: 500, reservedCostUsd: 0.2 },
      limits,
    )
    expect(claimed.ok && claimed.task.state).toBe('claimed')
    if (!claimed.ok) return
    expect(claimed.reservation).toEqual({ type: 'hold', donorId: 'ada', amount: 0.2 })

    const running = transition(claimed.task, { type: 'start', donorId: 'ada', leaseUntil: 900 }, limits)
    expect(running.ok && running.task.state).toBe('running')
    if (!running.ok) return

    const done = transition(running.task, { type: 'succeed', donorId: 'ada', result: 'shipped' }, limits)
    expect(done.ok).toBe(true)
    if (!done.ok) return
    expect(done.task).toMatchObject({ state: 'done', result: 'shipped', reservedCostUsd: 0, leaseUntil: null })
    expect(done.reservation).toEqual({ type: 'charge', donorId: 'ada', amount: 0.2 })
  })

  it('returns a vanished claim to open and releases the hold', () => {
    const claimed = task({ state: 'claimed', donorId: 'ada', leaseUntil: 100, reservedCostUsd: 0.2 })
    const tooSoon = transition(claimed, { type: 'lease_expired', now: 99 }, limits)
    expect(tooSoon).toEqual({ ok: false, error: 'lease_active' })
    const expired = transition(claimed, { type: 'lease_expired', now: 100 }, limits)
    expect(expired.ok).toBe(true)
    if (!expired.ok) return
    expect(expired.task).toMatchObject({ state: 'open', donorId: null, leaseUntil: null, attempts: 0 })
    expect(expired.reservation).toEqual({ type: 'release', donorId: 'ada', amount: 0.2 })
  })

  it('fails a run, then retries until attempts are exhausted', () => {
    let current = task({ state: 'running', donorId: 'ada', reservedCostUsd: 0.1, leaseUntil: 50 })
    for (let attempt = 1; attempt <= 3; attempt++) {
      const failed = transition(current, { type: 'fail', donorId: 'ada', reason: 'no', result: 'partial' }, limits)
      expect(failed.ok).toBe(true)
      if (!failed.ok) return
      expect(failed.task.attempts).toBe(attempt)
      expect(failed.task.state).toBe('failed')
      expect(failed.reservation.type).toBe('release')
      const retried = transition(failed.task, { type: 'retry', depsDone: true }, limits)
      if (attempt < 3) {
        expect(retried.ok && retried.task.state).toBe('open')
        if (!retried.ok) return
        current = { ...retried.task, state: 'running', donorId: 'ada', reservedCostUsd: 0.1, leaseUntil: 50 }
      } else {
        expect(retried).toEqual({ ok: false, error: 'attempts_exhausted' })
      }
    }
  })

  it('sends a retry back to blocked when dependencies are not done', () => {
    const failed = task({ state: 'failed', donorId: 'ada', attempts: 1 })
    const retried = transition(failed, { type: 'retry', depsDone: false }, limits)
    expect(retried.ok && retried.task.state).toBe('blocked')
  })

  it('holds a submission in review until it is accepted', () => {
    const claimed = task({ state: 'claimed', donorId: 'ada', leaseUntil: 50, reservedCostUsd: 0.2 })
    const submitted = transition(claimed, { type: 'submit', donorId: 'ada' }, limits)
    expect(submitted.ok && submitted.task.state).toBe('review')
    if (!submitted.ok) return
    expect(submitted.reservation.type).toBe('none')
    const accepted = transition(submitted.task, { type: 'accept' }, limits)
    expect(accepted.ok && accepted.task.state).toBe('done')
    if (!accepted.ok) return
    expect(accepted.reservation).toEqual({ type: 'charge', donorId: 'ada', amount: 0.2 })
    const rejected = transition(submitted.task, { type: 'reject', reason: 'needs work' }, limits)
    expect(rejected.ok && rejected.task.state).toBe('open')
    if (!rejected.ok) return
    expect(rejected.reservation).toEqual({ type: 'release', donorId: 'ada', amount: 0.2 })
  })

  it('rejects claims and completions from the wrong state or donor', () => {
    expect(transition(task({ state: 'blocked' }), { type: 'claim', donorId: 'ada', leaseUntil: 1, reservedCostUsd: 0.1 }, limits)).toEqual({
      ok: false,
      error: 'blocked',
    })
    expect(transition(task({ state: 'done' }), { type: 'claim', donorId: 'ada', leaseUntil: 1, reservedCostUsd: 0.1 }, limits)).toEqual({
      ok: false,
      error: 'not_open',
    })
    expect(transition(task({ state: 'claimed', donorId: 'ada' }), { type: 'start', donorId: 'bea', leaseUntil: 1 }, limits)).toEqual({
      ok: false,
      error: 'donor_mismatch',
    })
    expect(transition(task(), { type: 'succeed', donorId: 'ada', result: 'x' }, limits)).toEqual({ ok: false, error: 'not_running' })
    expect(transition(task({ state: 'open' }), { type: 'dependencies_unmet' }, limits).ok).toBe(true)
  })
})
