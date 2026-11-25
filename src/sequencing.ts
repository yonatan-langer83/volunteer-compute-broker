// One open change per file. A task is held back while another task whose files
// overlap is being worked on or waiting for review, so two volunteers never edit
// the same file at once and nobody builds on a version that is about to change.

/** The fixed part of a path pattern: everything before the first wildcard. */
function stem(pattern: string): string {
  const clean = pattern.trim().replace(/^\.?\//, '')
  const star = clean.search(/[*?[{]/)
  return star === -1 ? clean : clean.slice(0, star)
}

function isPattern(pattern: string) {
  return /[*?[{]/.test(pattern) || pattern.trim().endsWith('/')
}

/** The path-like entries of a scope, as the workspace reads them ("docs/a.md (new file)" → "docs/a.md"). */
export function scopePaths(scope: string[]): string[] {
  return scope.map((item) => item.split(/\s+\(/)[0]!.trim()).filter((path) => /[./]/.test(path) && !path.includes(' '))
}

/** True when two path patterns could name the same file. Errs on the side of overlap. */
export function patternsOverlap(a: string, b: string): boolean {
  const sa = stem(a)
  const sb = stem(b)
  if (!isPattern(a) && !isPattern(b)) return sa === sb
  if (!isPattern(a)) return sa.startsWith(sb)
  if (!isPattern(b)) return sb.startsWith(sa)
  return sa.startsWith(sb) || sb.startsWith(sa)
}

export interface FileScope {
  id: string
  projectId: string
  scopeDo: string[]
}

/** The busy task that blocks `task`, if any. */
export function blockingTask(task: FileScope, busy: FileScope[]): FileScope | null {
  for (const other of busy) {
    if (other.id === task.id || other.projectId !== task.projectId) continue
    const mine = scopePaths(task.scopeDo)
    const theirs = scopePaths(other.scopeDo)
    if (mine.some((a) => theirs.some((b) => patternsOverlap(a, b)))) return other
  }
  return null
}
