import { costMatchesSize, isTaskSize, sizeBand, type TaskSize } from './task-size.js'

export type QualityTask = {
  goal: string
  instructions: string
  acceptance: string
  tests: string
  do: string[]
  dont: string[]
  deliverable: string
  size: TaskSize
  estimatedCostUsd: number
}

const VAGUE = /^(tbd|todo|fix it|fix the bug|do the task|do the thing|something|stuff|n\/a|none|test|tests)\.?$/i

export function lintTask(task: QualityTask, label: string): string[] {
  const errors: string[] = []
  lintGoal(task.goal, label, errors)
  lintInstructions(task.instructions, label, errors)
  lintAcceptance(task.acceptance, label, errors)
  lintTests(task.tests, label, errors)
  lintList(task.do, `${label}.do`, errors, 2)
  lintList(task.dont, `${label}.don't`, errors, 8)
  lintDeliverable(task.deliverable, label, errors)
  if (!isTaskSize(task.size)) {
    errors.push(`${label}.size must be small, medium, or large`)
  } else if (!costMatchesSize(task.estimatedCostUsd, task.size)) {
    const band = sizeBand(task.size)
    errors.push(
      `${label}.estimatedCostUsd ${task.estimatedCostUsd} is outside the ${task.size} band (more than ${band.minExclusive} and at most ${band.maxInclusive})`,
    )
  }
  return errors
}

function lintGoal(goal: string, label: string, errors: string[]): void {
  if (!goal) {
    errors.push(`${label}.goal is required (one sentence)`)
    return
  }
  if (goal.includes('\n')) errors.push(`${label}.goal must be one sentence, not several lines`)
  if (goal.length < 20 || goal.length > 240) errors.push(`${label}.goal must be 20-240 characters and one sentence`)
  if (!/[.!?]$/.test(goal)) errors.push(`${label}.goal must be one sentence ending with . ! or ?`)
  if (/[.!?]\s+\S/.test(goal)) errors.push(`${label}.goal must be one sentence`)
  if (VAGUE.test(goal.trim())) errors.push(`${label}.goal is too vague. Say the outcome in one sentence`)
}

function lintInstructions(instructions: string, label: string, errors: string[]): void {
  const lines = nonEmptyLines(instructions)
  if (lines.length < 2 || instructions.trim().length < 40) {
    errors.push(`${label}.instructions must be steps: at least two lines and 40 characters`)
  }
  if (VAGUE.test(instructions.trim())) errors.push(`${label}.instructions are too vague. Write the steps`)
}

function lintAcceptance(acceptance: string, label: string, errors: string[]): void {
  if (acceptance.trim().length < 20) errors.push(`${label}.acceptance must say how a reviewer checks the work (at least 20 characters)`)
  if (VAGUE.test(acceptance.trim())) errors.push(`${label}.acceptance is too vague. Say what must be true`)
}

function lintTests(tests: string, label: string, errors: string[]): void {
  const lines = nonEmptyLines(tests)
  if (lines.length === 0) {
    errors.push(`${label}.tests must list the exact commands to run, one per line`)
    return
  }
  if (lines.length === 1 && VAGUE.test(lines[0] ?? '')) {
    errors.push(`${label}.tests must be an exact command, for example "python -m pytest"`)
    return
  }
  const command = lines.some((line) => /\s/.test(line) || /^(npm|pnpm|yarn|node|python|pytest|cargo|go|make)\b/.test(line))
  if (!command) errors.push(`${label}.tests must include an exact command, not a description of testing`)
}

function lintList(items: string[], label: string, errors: string[], min: number): void {
  if (items.length === 0) {
    errors.push(`${label} must list at least one item`)
    return
  }
  for (const item of items) {
    if (item.trim().length < min || VAGUE.test(item.trim())) {
      errors.push(`${label} item "${item}" is too vague`)
    }
  }
}

function lintDeliverable(deliverable: string, label: string, errors: string[]): void {
  if (deliverable.trim().length < 15) {
    errors.push(`${label}.deliverable must say what to hand back and in what form`)
    return
  }
  if (!/patch|diff|pull request|\bpr\b/i.test(deliverable)) {
    errors.push(`${label}.deliverable must name the form, such as a unified diff or a pull request URL`)
  }
}

function nonEmptyLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}
