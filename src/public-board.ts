import type { SqliteStore } from './sqlite-store.js'

export type PublicTask = {
  id: string
  localId: string
  title: string
  size: string
  state: string
  safetyStatus: string
  doneAt: string | null
  donorHandle: string | null
  prUrl: string | null
  patchPath: string | null
}

export type PublicProject = {
  name: string
  nonprofit: boolean
  orgUrl: string | null
  github: string | null
  tasks: PublicTask[]
}

export type PublicDonor = {
  handle: string
  tasksCompleted: number
  projectsHelped: string[]
}

export type PublicBoard = {
  projects: PublicProject[]
  donors: PublicDonor[]
}

export async function loadPublicBoard(store: SqliteStore): Promise<PublicBoard> {
  await store.prepare()
  const projects = await store.listProjects()
  const donors = await store.listDonors()
  const handles = new Map(donors.map((donor) => [donor.id, donor.handle]))
  const helped = new Map<string, { tasks: number; projects: Set<string> }>()
  const listed: PublicProject[] = []
  for (const project of projects) {
    const tasks = await store.listTasks(project.id)
    const publicTasks = tasks.map((task) => {
      const handle = task.donorId ? handles.get(task.donorId) ?? null : null
      const done = task.state === 'done'
      if (done && handle) {
        const row = helped.get(handle) ?? { tasks: 0, projects: new Set<string>() }
        row.tasks += 1
        row.projects.add(project.name)
        helped.set(handle, row)
      }
      return {
        id: task.id,
        localId: task.localId,
        title: task.title,
        size: task.size,
        state: task.safetyStatus === 'flagged' ? 'safety review' : task.state,
        safetyStatus: task.safetyStatus,
        doneAt: done ? new Date(task.updatedAt).toISOString() : null,
        donorHandle: done ? handle : null,
        // Only accepted work is public. A pending submission is unreviewed and
        // could contain anything, so neither its link nor its diff is shown.
        prUrl: done ? task.submissionUrl : null,
        patchPath: done && task.submissionPatch ? `/public/tasks/${encodeURIComponent(task.id)}/patch` : null,
      }
    })
    listed.push({
      name: project.name,
      nonprofit: project.nonprofit,
      orgUrl: project.orgUrl,
      github: project.github,
      tasks: publicTasks,
    })
  }
  return {
    projects: listed,
    donors: [...helped.entries()].map(([handle, row]) => ({
      handle,
      tasksCompleted: row.tasks,
      projectsHelped: [...row.projects],
    })),
  }
}

export function renderPublicHtml(board: PublicBoard): string {
  const projects = board.projects
    .map((project) => {
      const rows = project.tasks
        .map((task) => {
          const when = task.doneAt ? escapeHtml(task.doneAt) : ''
          const who = task.donorHandle ? escapeHtml(task.donorHandle) : ''
          const link = task.prUrl
            ? `<a href="${escapeHtml(task.prUrl)}">pull request</a>`
            : task.patchPath
              ? `<a href="${escapeHtml(task.patchPath)}">patch</a>`
              : ''
          return `<tr><td>${escapeHtml(task.localId)}</td><td>${escapeHtml(task.title)}</td><td>${escapeHtml(task.size)}</td><td>${escapeHtml(task.state)}</td><td>${when}</td><td>${who}</td><td>${link}</td></tr>`
        })
        .join('')
      const org = project.orgUrl ? `<a href="${escapeHtml(project.orgUrl)}">${escapeHtml(project.orgUrl)}</a>` : ''
      const repo = project.github ? `<a href="${escapeHtml(project.github)}">repository</a>` : ''
      return `<section><h2>${escapeHtml(project.name)}</h2><p>${project.nonprofit ? 'Nonprofit' : 'Other'} ${org} ${repo}</p><table><thead><tr><th>Task</th><th>Title</th><th>Size</th><th>State</th><th>Done</th><th>Donor</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></section>`
    })
    .join('')
  const donors = board.donors
    .map(
      (donor) =>
        `<li>${escapeHtml(donor.handle)}: ${donor.tasksCompleted} accepted task${donor.tasksCompleted === 1 ? '' : 's'} across ${donor.projectsHelped.map(escapeHtml).join(', ')}</li>`,
    )
    .join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Volunteer work</title>
<style>
body { font-family: Georgia, serif; margin: 1.5rem; color: #1c1917; background: #fafaf9; }
h1 { font-size: 1.6rem; }
table { border-collapse: collapse; width: 100%; margin: 0.5rem 0 1.5rem; }
th, td { text-align: left; border-bottom: 1px solid #d6d3d1; padding: 0.35rem 0.5rem; vertical-align: top; }
a { color: #1d4ed8; }
@media (max-width: 700px) { table, thead, tbody, tr, th, td { display: block; } th { display: none; } td { border: 0; } }
</style>
</head>
<body>
<h1>Volunteer work</h1>
<p>Open tasks and finished work on nonprofit open-source projects. Donors are shown by the pseudonym they chose. The same facts are at <a href="/public.json">/public.json</a>.</p>
${projects || '<p>No projects yet.</p>'}
<h2>Donors</h2>
${donors ? `<ul>${donors}</ul>` : '<p>No accepted work yet.</p>'}
</body>
</html>`
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
