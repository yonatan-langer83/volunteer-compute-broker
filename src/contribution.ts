// The contribution record. Every volunteer change follows the same loop:
// plan (reviewable, before any edit), act (only on allowed files), evaluate
// (checks and per-criterion evidence), and a human decides on GitHub.
// The pull request carries the whole record, so a reviewer can judge it as
// they would any contributor's: goal, plan, bounded change, evidence, warnings.

import { createHash } from 'node:crypto'

import { parseUnifiedDiff } from './github-app.js'
import type { TaskRecord } from './types.js'
import { editablePaths, isEditable } from './workspace.js'

export type Plan = { understanding: string; files: string[]; steps: string[]; verify: string; fallback: string }
export type Evidence = { criterion: string; evidence: string }[]

const clip = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)

// The exact brief a volunteer was given, as stored. Its fingerprint goes in the
// pull request, so anyone can check the work was done against this brief.
export function canonicalBrief(task: TaskRecord, agentsMd: string | null) {
  return {
    title: task.title,
    kind: task.kind,
    goal: task.goal,
    instructions: task.instructions,
    acceptance: task.acceptance,
    tests: task.tests,
    do: task.scopeDo,
    dont: task.scopeDont,
    deliverable: task.deliverable,
    agentsMd,
  }
}

export function briefFingerprint(brief: ReturnType<typeof canonicalBrief>): string {
  return createHash('sha256').update(JSON.stringify(brief)).digest('hex')
}

export function validatePlan(task: TaskRecord, input: Partial<Plan>): { ok: true; plan: Plan } | { ok: false; reason: string } {
  const plan: Plan = {
    understanding: clip(input.understanding, 800),
    files: (input.files ?? []).map((f) => clip(f, 300)).filter(Boolean).slice(0, 30),
    steps: (input.steps ?? []).map((s) => clip(s, 400)).filter(Boolean).slice(0, 12),
    verify: clip(input.verify, 800),
    fallback: clip(input.fallback, 600),
  }
  if (plan.understanding.length < 20) return { ok: false, reason: 'Say in a sentence or two what the task asks for, in your own words.' }
  if (plan.steps.length === 0) return { ok: false, reason: 'List the steps you will take.' }
  if (plan.verify.length < 10) return { ok: false, reason: 'Say how you will check the result against the acceptance criteria.' }
  if (plan.fallback.length < 10) return { ok: false, reason: 'Say what you will do if it does not work: for example, release the task with the reason, or which part a person should decide.' }
  if (plan.files.length === 0) return { ok: false, reason: `List the files you will change. This task allows: ${editablePaths(task).join(', ') || 'none'}.` }
  const outside = plan.files.filter((f) => !isEditable(task, f))
  if (outside.length) {
    return { ok: false, reason: `These files are outside the task: ${outside.join(', ')}. This task allows: ${editablePaths(task).join(', ') || 'none'}. If the task can't be done within them, release_task and say why.` }
  }
  return { ok: true, plan }
}

export function validateEvidence(input: unknown): Evidence {
  if (!Array.isArray(input)) return []
  return input.slice(0, 20).map((item) => ({
    criterion: clip((item as { criterion?: unknown }).criterion, 400),
    evidence: clip((item as { evidence?: unknown }).evidence, 1200),
  })).filter((item) => item.criterion && item.evidence)
}

export function patchPaths(patch: string): string[] {
  const paths = new Set<string>()
  for (const file of parseUnifiedDiff(patch)) {
    if (file.oldPath) paths.add(file.oldPath)
    if (file.newPath) paths.add(file.newPath)
  }
  return [...paths]
}

// ---------- warning signs in a change ----------

export type Warning = { kind: string; file: string; detail: string; blocking: boolean }

const CHECKS: { kind: string; pattern: RegExp; detail: string; blocking?: boolean }[] = [
  { kind: 'hidden-text', pattern: /[‪-‮⁦-⁩]/, detail: 'invisible text-direction characters (can make code read differently than it runs)', blocking: true },
  { kind: 'hidden-text', pattern: /[​-‍⁠﻿]/, detail: 'invisible zero-width characters' },
  { kind: 'secret', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, detail: 'a private key', blocking: true },
  { kind: 'secret', pattern: /\b(AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|sk-[A-Za-z0-9_-]{32,}|xox[baprs]-[A-Za-z0-9-]{10,}|vbk_[A-Za-z0-9_-]{30,})\b/, detail: 'something that looks like a password or access key', blocking: true },
  { kind: 'runs-code', pattern: /\b(eval|exec)\s*\(|new\s+Function\s*\(|child_process|subprocess\.|os\.system\s*\(|Runtime\.getRuntime/, detail: 'code that runs other code or commands' },
  { kind: 'download-and-run', pattern: /(curl|wget)\b[^\n|]*\|\s*(ba|z)?sh\b/, detail: 'downloads something and runs it' },
  { kind: 'network', pattern: /\bfetch\s*\(|XMLHttpRequest|\brequests\.(get|post|put)|urllib|http\.client|net\.connect|socket\.|WebSocket\s*\(/, detail: 'a new network call' },
  { kind: 'install-hook', pattern: /"(pre|post)install"\s*:|cmdclass\s*=/, detail: 'a script that runs when the project is installed' },
  { kind: 'encoded-blob', pattern: /[A-Za-z0-9+/=]{200,}/, detail: 'a long encoded string (could hide content)' },
]

// Looks only at added lines. Blocking warnings stop the submission; the others
// are listed in the pull request so the reviewer looks closely.
export function scanPatch(patch: string): Warning[] {
  const warnings: Warning[] = []
  const seen = new Set<string>()
  let file = ''
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.slice(4).replace(/^b\//, '').trim()
      continue
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue
    const added = line.slice(1)
    const add = (kind: string, detail: string, blocking: boolean) => {
      const key = `${kind}:${file}:${detail}`
      if (seen.has(key)) return
      seen.add(key)
      warnings.push({ kind, file, detail, blocking })
    }
    for (const check of CHECKS) if (check.pattern.test(added)) add(check.kind, check.detail, !!check.blocking)
    if (added.length > 1000) add('very-long-line', 'a very long line (minified or generated content)', false)
  }
  return warnings
}

// ---------- the pull request description ----------

export type RecordInput = {
  task: TaskRecord
  brief: ReturnType<typeof canonicalBrief>
  volunteer: string
  summary: string
  plan: Plan | null
  evidence: Evidence
  patch: string
  checks: { status: string; output?: string | null } | null
}

const fence = (text: string) => `\`\`\`\n${text.replace(/```/g, '` ` `')}\n\`\`\``

export function pullRequestRecord(input: RecordInput): string {
  const { task, brief } = input
  const allowed = editablePaths(task)
  const changed = patchPaths(input.patch)
  const outside = changed.filter((p) => !isEditable(task, p))
  const warnings = scanPatch(input.patch)
  const lines: string[] = []
  lines.push('### Goal', '', task.goal || task.title, '')
  lines.push('### Plan (stated before any change)', '')
  if (input.plan) {
    lines.push(`**Understanding:** ${input.plan.understanding}`, '')
    lines.push(...input.plan.steps.map((s, i) => `${i + 1}. ${s}`), '')
    lines.push(`**How it was checked:** ${input.plan.verify}`, '')
    if (input.plan.fallback) lines.push(`**If it doesn't work:** ${input.plan.fallback}`, '')
  } else {
    lines.push('_No plan was recorded (submitted from a coding tool before plans were required)._', '')
  }
  lines.push('### Change', '')
  lines.push(`Files changed: ${changed.map((p) => `\`${p}\``).join(', ') || 'none'}`)
  lines.push(`Files the task allows: ${allowed.map((p) => `\`${p}\``).join(', ') || 'none'}`)
  lines.push(outside.length ? `**Outside the task:** ${outside.map((p) => `\`${p}\``).join(', ')}` : 'All changes are inside the task.', '')
  lines.push('### Evidence', '')
  if (input.checks) lines.push(`Project checks on the server: **${input.checks.status}**`, '')
  else lines.push(task.kind === 'code' ? 'Project checks: not run on the server (the volunteer used their own coding tool). CI on this pull request is the check.' : 'Writing task: no automated checks.', '')
  if (input.evidence.length) {
    lines.push('| Acceptance criterion | Volunteer\'s evidence |', '|---|---|')
    for (const e of input.evidence) lines.push(`| ${e.criterion.replace(/\|/g, '\\|').replace(/\n/g, ' ')} | ${e.evidence.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`)
    lines.push('')
  }
  lines.push('**Volunteer\'s summary:**', '', input.summary.slice(0, 4000), '')
  if (input.checks?.output) lines.push('<details><summary>Check output</summary>', '', fence(input.checks.output.slice(-6000)), '', '</details>', '')
  lines.push('### Warning signs', '')
  lines.push(warnings.length
    ? warnings.map((w) => `- ${w.blocking ? '**Blocked:** ' : ''}\`${w.file}\`: ${w.detail}`).join('\n')
    : 'None found in the added lines (hidden characters, secrets, code that runs commands, new network calls, install scripts, encoded blobs).', '')
  lines.push('### Review checklist', '')
  lines.push(
    '- [ ] **Intent:** the change does what the goal says, and nothing else.',
    '- [ ] **Scope:** only the expected files changed.',
    '- [ ] **Evidence:** checks pass, and each acceptance criterion is really met.',
    '- [ ] **Ownership:** someone on your team understands this change and will maintain it.',
    '- [ ] **Policy:** no secrets, new dependencies or network calls you did not ask for.',
    '- [ ] **Fallback:** if it goes wrong, reverting this pull request is enough.',
    '',
    'Not right yet? **Request changes** with what is missing, then close the pull request: the task goes back to the pool and the next volunteer sees your feedback. Merge only when your required checks pass.',
    '',
  )
  lines.push('<details><summary>The brief the volunteer received</summary>', '', fence(JSON.stringify(brief, null, 2).slice(0, 20000)), '', `Fingerprint (SHA-256): \`${briefFingerprint(brief)}\``, '', '</details>', '')
  lines.push(`_Volunteer: ${input.volunteer}. AI changes who does the work, not who owns the result: merging is your decision._`)
  return lines.join('\n')
}
