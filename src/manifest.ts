import { readFileSync } from 'node:fs'

import { parse } from 'yaml'

import { lintTask } from './task-quality.js'
import { isTaskSize, type TaskSize } from './task-size.js'
import { isProviderId, type ProviderId } from './types.js'

export type TaskKind = 'code' | 'writing'

// How the broker runs a project's checks on a volunteer's work: shell
// commands run from the repository root in a fresh Linux test machine with
// Python 3, Node.js and git. setup runs first (install dependencies), then run.
export type ProjectChecks = { setup?: string; run: string }

export type ManifestTask = {
  id: string
  kind: TaskKind
  // true when the task can only be done on the volunteer's own computer (not in a chat app)
  needsComputer: boolean
  title: string
  goal: string
  instructions: string
  acceptance: string
  tests: string
  do: string[]
  dont: string[]
  deliverable: string
  size: TaskSize
  dependsOn: string[]
  provider?: ProviderId
  estimatedCostUsd: number
}

export type Manifest = {
  schemaVersion: 1
  project: { name: string; github?: string; nonprofit: boolean; orgUrl?: string; checks?: ProjectChecks }
  tasks: ManifestTask[]
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestError'
  }
}

const TASK_ID = /^[a-z][a-z0-9-]{0,63}$/
const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/

export function loadManifest(filePath: string): Manifest {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    throw new ManifestError(`manifest not found: ${filePath}`)
  }
  return parseManifestYaml(raw)
}

export function parseManifestYaml(raw: string): Manifest {
  let document: unknown
  try {
    document = parse(raw)
  } catch {
    throw new ManifestError('manifest is not valid YAML')
  }
  return validateManifest(document)
}

export function validateManifest(document: unknown): Manifest {
  const errors: string[] = []
  if (!isRecord(document)) throw new ManifestError('manifest must be a YAML mapping')
  if (document.schemaVersion !== 1) errors.push('schemaVersion must be 1')
  const project = isRecord(document.project) ? document.project : null
  if (!project) errors.push('project must be a mapping')
  const name = project && typeof project.name === 'string' ? project.name : ''
  if (!PROJECT_NAME.test(name)) errors.push('project.name must be 1-81 letters, digits, dots, underscores, or hyphens')
  let github: string | undefined
  if (project && project.github != null) {
    if (typeof project.github !== 'string' || project.github.length === 0 || project.github.length > 300) {
      errors.push('project.github must be a short string when set')
    } else {
      github = project.github
    }
  }
  const nonprofitFlag = readFlag(project, 'nonprofit', errors)
  const publicGoodFlag = readFlag(project, 'publicGood', errors)
  if (nonprofitFlag != null && publicGoodFlag != null && nonprofitFlag !== publicGoodFlag) {
    errors.push('project.nonprofit and project.publicGood disagree')
  }
  const nonprofit = nonprofitFlag === true || publicGoodFlag === true
  let orgUrl: string | undefined
  if (project && project.orgUrl != null) {
    if (typeof project.orgUrl !== 'string' || project.orgUrl.length === 0 || project.orgUrl.length > 300) {
      errors.push('project.orgUrl must be a short string when set')
    } else {
      orgUrl = project.orgUrl
    }
  }
  let checks: ProjectChecks | undefined
  if (project && project.checks != null) {
    const raw = project.checks
    const run = isRecord(raw) ? readText(raw.run) : ''
    const setup = isRecord(raw) ? readText(raw.setup) : ''
    if (!run || run.length > 2000 || setup.length > 2000) {
      errors.push('project.checks must be a mapping with run (and optional setup) shell commands')
    } else {
      checks = { run, ...(setup ? { setup } : {}) }
    }
  }
  if (!Array.isArray(document.tasks) || document.tasks.length === 0) {
    errors.push('tasks must be a non-empty list')
  }
  const tasks: ManifestTask[] = []
  const seen = new Set<string>()
  if (Array.isArray(document.tasks)) {
    for (const [index, entry] of document.tasks.entries()) {
      const parsed = parseTask(entry, index, errors)
      if (!parsed) continue
      if (seen.has(parsed.id)) errors.push(`duplicate task id ${parsed.id}`)
      seen.add(parsed.id)
      tasks.push(parsed)
    }
  }
  for (const task of tasks) {
    const deps = new Set<string>()
    for (const dependency of task.dependsOn) {
      if (!seen.has(dependency)) errors.push(`task ${task.id} depends on unknown task ${dependency}`)
      if (deps.has(dependency)) errors.push(`task ${task.id} lists ${dependency} more than once`)
      deps.add(dependency)
    }
  }
  const cycle = findCycle(tasks)
  if (cycle) errors.push(`dependency cycle: ${cycle.join(' -> ')}`)
  if (errors.length > 0) throw new ManifestError(errors.join('\n'))
  return {
    schemaVersion: 1,
    project: { name, nonprofit, ...(github ? { github } : {}), ...(orgUrl ? { orgUrl } : {}), ...(checks ? { checks } : {}) },
    tasks,
  }
}

function readFlag(project: Record<string, unknown> | null, key: string, errors: string[]): boolean | null {
  if (!project || project[key] == null) return null
  const value = project[key]
  if (typeof value !== 'boolean') {
    errors.push(`project.${key} must be true or false`)
    return null
  }
  return value
}

export function findCycle(tasks: { id: string; dependsOn: string[] }[]): string[] | null {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const color = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []

  const visit = (id: string): string[] | null => {
    const mark = color.get(id) ?? 0
    if (mark === 1) {
      const start = stack.indexOf(id)
      return [...stack.slice(start), id]
    }
    if (mark === 2) return null
    color.set(id, 1)
    stack.push(id)
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(dependency)) continue
      const cycle = visit(dependency)
      if (cycle) return cycle
    }
    stack.pop()
    color.set(id, 2)
    return null
  }

  for (const task of tasks) {
    const cycle = visit(task.id)
    if (cycle) return cycle
  }
  return null
}

function parseTask(entry: unknown, index: number, errors: string[]): ManifestTask | null {
  const label = `tasks[${index}]`
  if (!isRecord(entry)) {
    errors.push(`${label} must be a mapping`)
    return null
  }
  const id = typeof entry.id === 'string' ? entry.id : ''
  if (!TASK_ID.test(id)) errors.push(`${label}.id must be a lowercase slug`)
  const title = typeof entry.title === 'string' ? entry.title.trim() : ''
  if (title.length === 0 || title.length > 120) errors.push(`${label}.title must be 1-120 characters`)
  const goal = typeof entry.goal === 'string' ? entry.goal.trim() : ''
  if (!goal) errors.push(`${label}.goal is required (one sentence)`)
  const instructions = typeof entry.instructions === 'string' ? entry.instructions.trim() : ''
  if (instructions.length === 0 || instructions.length > 20_000) errors.push(`${label}.instructions must be the steps`)
  const acceptance = typeof entry.acceptance === 'string' ? entry.acceptance.trim() : ''
  if (acceptance.length === 0 || acceptance.length > 20_000) errors.push(`${label}.acceptance is required`)
  let kind: TaskKind = 'code'
  if (entry.kind != null) {
    if (entry.kind === 'code' || entry.kind === 'writing') kind = entry.kind
    else errors.push(`${label}.kind must be code or writing`)
  }
  let needsComputer = false
  if (entry.needs != null) {
    if (entry.needs === 'computer') needsComputer = true
    else errors.push(`${label}.needs can only be computer`)
  }
  // Writing tasks (docs, translations, research notes) may have no commands:
  // the organization checks them by reading.
  const tests = readText(entry.tests) || (kind === 'writing' ? 'No commands: the organization reads the result against the acceptance criteria.' : '')
  if (!tests) errors.push(`${label}.tests must list the exact commands to run`)
  const scopeDo = readList(entry.do)
  if (!scopeDo) errors.push(`${label}.do must be a list of what the volunteer may touch`)
  const scopeDont = readList(entry["don't"] ?? entry.dont)
  if (!scopeDont) errors.push(`${label}.don't must be a list of what the volunteer must not do`)
  const deliverable = typeof entry.deliverable === 'string' ? entry.deliverable.trim() : ''
  if (!deliverable) errors.push(`${label}.deliverable is required`)
  const size = typeof entry.size === 'string' && isTaskSize(entry.size) ? entry.size : null
  if (!size) errors.push(`${label}.size must be small, medium, or large`)
  let provider: ProviderId | undefined
  if (entry.provider != null) {
    if (typeof entry.provider !== 'string' || !isProviderId(entry.provider)) {
      errors.push(`${label}.provider must be anthropic, openai, xai, or google`)
    } else {
      provider = entry.provider
    }
  }
  let estimatedCostUsd = 0
  if (typeof entry.estimatedCostUsd !== 'number' || !Number.isFinite(entry.estimatedCostUsd) || entry.estimatedCostUsd <= 0) {
    errors.push(`${label}.estimatedCostUsd is required and must be a positive number`)
  } else {
    estimatedCostUsd = entry.estimatedCostUsd
  }
  // A file a volunteer may edit must be one the instructions actually talk
  // about. This catches briefs whose do list was filled in generically and
  // contradicts the instructions (the harbor-pantry test hit exactly that).
  if (scopeDo && instructions) {
    const brief = `${instructions}\n${acceptance}`
    for (const item of scopeDo) {
      const path = item.split(/\s+\(/)[0]!.trim()
      if (/[./]/.test(path) && !brief.includes(path)) {
        errors.push(`${label}.do names ${path}, but the instructions and acceptance never mention it`)
      }
    }
  }
  const dependsOn: string[] = []
  if (entry.dependsOn != null) {
    if (!Array.isArray(entry.dependsOn) || entry.dependsOn.some((item) => typeof item !== 'string')) {
      errors.push(`${label}.dependsOn must be a list of task ids`)
    } else {
      dependsOn.push(...entry.dependsOn)
    }
  }
  if (goal && instructions && acceptance && tests && scopeDo && scopeDont && deliverable && size && estimatedCostUsd > 0) {
    errors.push(
      ...lintTask(
        {
          goal,
          instructions,
          acceptance,
          tests,
          do: scopeDo,
          dont: scopeDont,
          deliverable,
          size,
          estimatedCostUsd,
        },
        label,
      ),
    )
  }
  if (!id || !size || !tests || !scopeDo || !scopeDont) return null
  return {
    id,
    kind,
    needsComputer,
    title,
    goal,
    instructions,
    acceptance,
    tests,
    do: scopeDo,
    dont: scopeDont,
    deliverable,
    size,
    dependsOn,
    ...(provider ? { provider } : {}),
    estimatedCostUsd,
  }
}

function readText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.map((item) => item.trim()).filter(Boolean).join('\n')
  return ''
}

function readList(value: unknown): string[] | null {
  if (typeof value === 'string' && value.trim()) return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
  if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')) {
    return value.map((item) => item.trim()).filter(Boolean)
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
