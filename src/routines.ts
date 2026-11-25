// The house rules the server enforces, in one place. The handbook
// (docs/handbook/what-happens-when.md) explains each one in plain words;
// change both together.

export const POLICY = {
  // An organization with this many changes waiting for review gets no new
  // work started until it reviews some: nobody's effort waits in a long queue.
  reviewCap: 5,
  // A task handed back (closed without merging, or released with a reason)
  // this many times since its brief last changed is taken off the board until
  // the organization improves the brief.
  returnsBeforePause: 3,
  // A volunteer's recent record decides the size of work they get.
  trackWindowMs: 30 * 24 * 60 * 60 * 1000,
  probationAfterRejections: 3,
  pauseAfterRejections: 6,
  // Work labelled "spam" or "invalid" by a maintainer weighs much more.
  pauseAfterSpam: 2,
  // After "request changes", the volunteer who made the change may revise it
  // first, for this long; then any volunteer may continue the pull request.
  revisionFirstChanceMs: 3 * 24 * 60 * 60 * 1000,
  // Reminders on pull requests nobody has reviewed, in days after hand-in.
  reviewReminderDays: [7, 21],
} as const

export const PAUSED_FOR_BRIEF = `Handed back ${POLICY.returnsBeforePause} times. Paused until the organization improves the brief.`

export const REMOVED_FROM_LIST = 'Removed from the task list by the organization.'

export type TrackStanding = { level: 'normal' } | { level: 'small-only'; message: string } | { level: 'paused'; message: string }

export function standing(record: { accepted: number; rejected: number; spam?: number }): TrackStanding {
  const spam = record.spam ?? 0
  if (spam >= POLICY.pauseAfterSpam) {
    return { level: 'paused', message: `${spam} of your recent hand-ins were labelled spam by the organization. Volunteering is paused; write to us if you think this is a mistake.` }
  }
  if (spam >= 1 && record.accepted <= spam) {
    return { level: 'small-only', message: 'An organization labelled one of your recent hand-ins as spam, so for now you get one small task per shift. Accepted work lifts this.' }
  }
  if (record.rejected >= POLICY.pauseAfterRejections && record.accepted === 0) {
    return { level: 'paused', message: `${record.rejected} of your recent hand-ins were turned down and none was accepted. Volunteering is paused for now; write to us and we'll look at it together.` }
  }
  if (record.rejected >= POLICY.probationAfterRejections && record.rejected > record.accepted) {
    return { level: 'small-only', message: 'Several of your recent hand-ins were turned down, so for now you get one small task per session. Read the reviewers\' feedback in each brief; accepted work lifts this.' }
  }
  return { level: 'normal' }
}

export function briefKey(task: { title: string; goal: string; instructions: string; acceptance: string; tests: string; scopeDo: string[]; scopeDont: string[]; deliverable: string; size: string; kind?: string; needsComputer?: boolean }): string {
  return JSON.stringify([task.title, task.goal, task.instructions, task.acceptance, task.tests, task.scopeDo, task.scopeDont, task.deliverable, task.size, task.kind ?? 'code', !!task.needsComputer])
}
