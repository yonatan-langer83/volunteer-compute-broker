// GitHub App integration. The broker opens a pull request for each volunteer
// submission, and a merge or close on GitHub becomes accept or reject. Only
// Web Crypto and fetch are used, so this runs in Workers and in Node tests.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type AppCredentials = {
  appId: string
  slug: string
  privateKeyPem: string
  webhookSecret: string
}

const API = 'https://api.github.com'
const TOKEN_CACHE = new Map<string, { token: string; expires: number }>()
const TREE_CACHE = new Map<string, { path: string; size: number }[]>()
const enc = new TextEncoder()

// ---------- keys and tokens ----------

function pemToDer(pem: string): { der: Uint8Array; pkcs1: boolean } {
  const pkcs1 = pem.includes('BEGIN RSA PRIVATE KEY')
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const bin = atob(body)
  const der = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i)
  return { der, pkcs1 }
}

function derLength(n: number): number[] {
  if (n < 0x80) return [n]
  const bytes: number[] = []
  while (n > 0) {
    bytes.unshift(n & 0xff)
    n >>= 8
  }
  return [0x80 | bytes.length, ...bytes]
}

// GitHub hands out PKCS#1 keys; Web Crypto only imports PKCS#8. Wrap it.
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]
  const octet = [0x04, ...derLength(pkcs1.length)]
  const inner = [0x02, 0x01, 0x00, ...algorithm, ...octet]
  const total = inner.length + pkcs1.length
  const out = new Uint8Array([0x30, ...derLength(total), ...inner, ...pkcs1])
  return out
}

async function importAppKey(pem: string): Promise<CryptoKey> {
  const { der, pkcs1 } = pemToDer(pem)
  const pkcs8 = pkcs1 ? pkcs1ToPkcs8(der) : der
  return crypto.subtle.importKey('pkcs8', pkcs8 as unknown as ArrayBuffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
}

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? enc.encode(data) : data
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export async function appJwt(appId: string, privateKeyPem: string, nowMs: number): Promise<string> {
  const now = Math.floor(nowMs / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }))
  const key = await importAppKey(privateKeyPem)
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${payload}`))
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`
}

export async function verifyWebhookSignature(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)))
  const expected = 'sha256=' + [...mac].map((b) => b.toString(16).padStart(2, '0')).join('')
  if (expected.length !== header.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i)
  return diff === 0
}

export function parseRepo(github: string | null): { owner: string; repo: string } | null {
  const match = github?.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/)
  return match ? { owner: match[1]!, repo: match[2]! } : null
}

// ---------- unified diff ----------

export type FilePatch = { oldPath: string | null; newPath: string | null; hunks: Hunk[] }
type Hunk = { oldStart: number; lines: string[] }

export function parseUnifiedDiff(patch: string): FilePatch[] {
  const lines = patch.replace(/\r\n/g, '\n').split('\n')
  const files: FilePatch[] = []
  let current: FilePatch | null = null
  let hunk: Hunk | null = null
  const strip = (p: string) => {
    const path = p.split('\t')[0]!.trim()
    if (path === '/dev/null') return null
    return path.replace(/^[ab]\//, '')
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) {
      current = { oldPath: strip(line.slice(4)), newPath: strip(lines[i + 1]!.slice(4)), hunks: [] }
      files.push(current)
      hunk = null
      i++
      continue
    }
    const header = line.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/)
    if (header && current) {
      hunk = { oldStart: Number(header[1]), lines: [] }
      current.hunks.push(hunk)
      continue
    }
    if (hunk && (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-'))) {
      hunk.lines.push(line)
    } else if (hunk && line === '' && i < lines.length - 1) {
      hunk.lines.push(' ')
    } else if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file')) {
      hunk = null
    }
  }
  return files
}

export function applyFilePatch(original: string | null, file: FilePatch): string | null {
  if (file.newPath === null) return null
  const hadNewline = original === null || original.endsWith('\n')
  const source = original === null || original === '' ? [] : original.replace(/\n$/, '').split('\n')
  const out: string[] = []
  let cursor = 0
  for (const hunk of file.hunks) {
    const before = hunk.lines.filter((l) => !l.startsWith('+')).map((l) => l.slice(1))
    const after = hunk.lines.filter((l) => !l.startsWith('-')).map((l) => l.slice(1))
    const want = Math.max(0, hunk.oldStart - 1)
    let at = -1
    for (let offset = 0; offset <= source.length && at < 0; offset++) {
      for (const candidate of [want + offset, want - offset]) {
        if (candidate < cursor || candidate + before.length > source.length) continue
        if (before.every((l, k) => source[candidate + k] === l)) {
          at = candidate
          break
        }
      }
    }
    if (at < 0) throw new Error(`patch does not apply to ${file.newPath}`)
    out.push(...source.slice(cursor, at), ...after)
    cursor = at + before.length
  }
  out.push(...source.slice(cursor))
  return out.join('\n') + (hadNewline || out.length ? '\n' : '')
}

// ---------- API ----------

export class GitHubApp {
  constructor(
    private readonly creds: AppCredentials,
    private readonly fetcher: FetchLike = (input, init) => fetch(input, init),
    private readonly now: () => number = () => Date.now(),
  ) {}

  get botLogin(): string {
    return `${this.creds.slug}[bot]`
  }

  private async call<T>(token: string, method: string, path: string, body?: unknown, auth = 'token'): Promise<T> {
    const response = await this.fetcher(`${API}${path}`, {
      method,
      headers: {
        authorization: `${auth} ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'volunteer-compute-broker',
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) throw new Error(`GitHub ${method} ${path} failed: ${response.status}`)
    return (response.status === 204 ? null : await response.json()) as T
  }

  async installationToken(owner: string, repo: string): Promise<string> {
    const key = `${this.creds.appId}:${owner}/${repo}`.toLowerCase()
    const cached = TOKEN_CACHE.get(key)
    if (cached && cached.expires > this.now() + 5 * 60 * 1000) return cached.token
    const jwt = await appJwt(this.creds.appId, this.creds.privateKeyPem, this.now())
    const install = await this.call<{ id: number }>(jwt, 'GET', `/repos/${owner}/${repo}/installation`, undefined, 'Bearer')
    const token = await this.call<{ token: string; expires_at?: string }>(jwt, 'POST', `/app/installations/${install.id}/access_tokens`, {}, 'Bearer')
    const expires = token.expires_at ? Date.parse(token.expires_at) : this.now() + 50 * 60 * 1000
    TOKEN_CACHE.set(key, { token: token.token, expires })
    return token.token
  }

  // What a GitHub user may do in a repository: 'admin', 'maintain', 'write',
  // 'triage', 'read' or 'none'. Used to show organizations their own projects.
  async collaboratorPermission(owner: string, repo: string, login: string): Promise<string> {
    const token = await this.installationToken(owner, repo)
    try {
      const result = await this.call<{ permission?: string; role_name?: string }>(token, 'GET', `/repos/${owner}/${repo}/collaborators/${encodeURIComponent(login)}/permission`)
      return result.role_name ?? result.permission ?? 'none'
    } catch {
      return 'none'
    }
  }

  async commentOnPullRequest(url: string, body: string): Promise<boolean> {
    const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
    if (!match) return false
    const [, owner, repo, number] = match
    const token = await this.installationToken(owner!, repo!)
    await this.call(token, 'POST', `/repos/${owner}/${repo}/issues/${number}/comments`, { body })
    return true
  }

  async pullRequestBody(owner: string, repo: string, number: number): Promise<{ body: string | null; user: string; url: string } | null> {
    const token = await this.installationToken(owner, repo)
    try {
      const pr = await this.call<{ body: string | null; user: { login: string }; html_url: string }>(token, 'GET', `/repos/${owner}/${repo}/pulls/${number}`)
      return { body: pr.body, user: pr.user.login, url: pr.html_url }
    } catch {
      return null
    }
  }

  // Which protections the default branch has, from GitHub's rules API.
  async branchProtections(owner: string, repo: string): Promise<{ branch: string; pullRequestRequired: boolean; checksRequired: boolean; reviewsRequired: number } | null> {
    const token = await this.installationToken(owner, repo)
    try {
      const info = await this.call<{ default_branch: string }>(token, 'GET', `/repos/${owner}/${repo}`)
      const rules = await this.call<{ type: string; parameters?: { required_approving_review_count?: number } }[]>(token, 'GET', `/repos/${owner}/${repo}/rules/branches/${encodeURIComponent(info.default_branch)}`)
      const pr = rules.find((r) => r.type === 'pull_request')
      return {
        branch: info.default_branch,
        pullRequestRequired: !!pr,
        checksRequired: rules.some((r) => r.type === 'required_status_checks'),
        reviewsRequired: pr?.parameters?.required_approving_review_count ?? 0,
      }
    } catch {
      return null
    }
  }

  // ---------- reading a repository for a volunteer's workspace ----------

  async headSha(owner: string, repo: string): Promise<string> {
    const token = await this.installationToken(owner, repo)
    const info = await this.call<{ default_branch: string }>(token, 'GET', `/repos/${owner}/${repo}`)
    const ref = await this.call<{ object: { sha: string } }>(token, 'GET', `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(info.default_branch)}`)
    return ref.object.sha
  }

  async listFiles(owner: string, repo: string, sha: string): Promise<{ path: string; size: number }[]> {
    const cacheKey = `${owner}/${repo}@${sha}`.toLowerCase()
    const cached = TREE_CACHE.get(cacheKey)
    if (cached) return cached
    const token = await this.installationToken(owner, repo)
    const tree = await this.call<{ tree: { path: string; type: string; size?: number }[]; truncated?: boolean }>(
      token, 'GET', `/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    )
    const files = tree.tree.filter((entry) => entry.type === 'blob').map((entry) => ({ path: entry.path, size: entry.size ?? 0 }))
    if (TREE_CACHE.size > 50) TREE_CACHE.clear()
    TREE_CACHE.set(cacheKey, files)
    return files
  }

  async readFile(owner: string, repo: string, sha: string, path: string): Promise<string | null> {
    const token = await this.installationToken(owner, repo)
    const response = await this.fetcher(`${API}/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`, {
      headers: {
        authorization: `token ${token}`,
        accept: 'application/vnd.github.raw+json',
        'user-agent': 'volunteer-compute-broker',
        'x-github-api-version': '2022-11-28',
      },
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`GitHub GET contents ${path} failed: ${response.status}`)
    return await response.text()
  }

  // A short-lived download link for the repository at sha, for a test machine.
  async tarballUrl(owner: string, repo: string, sha: string): Promise<string> {
    const token = await this.installationToken(owner, repo)
    const response = await this.fetcher(`${API}/repos/${owner}/${repo}/tarball/${sha}`, {
      method: 'GET',
      redirect: 'manual',
      headers: { authorization: `token ${token}`, 'user-agent': 'volunteer-compute-broker', 'x-github-api-version': '2022-11-28' },
    })
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) return location
    throw new Error(`GitHub tarball link failed: ${response.status}`)
  }

  async openVolunteerPr(input: {
    owner: string
    repo: string
    taskId: string
    localId: string
    title: string
    volunteer: string
    summary: string
    patch: string
    record?: string
  }): Promise<string> {
    const files = parseUnifiedDiff(input.patch)
    if (files.length === 0) throw new Error('the diff has no files')
    for (const f of files) {
      for (const p of [f.oldPath, f.newPath]) {
        if (p && (p.startsWith('.github/') || p.startsWith('.git/') || p.includes('..'))) throw new Error(`the diff touches ${p}`)
      }
    }
    const { owner, repo } = input
    const token = await this.installationToken(owner, repo)
    const info = await this.call<{ default_branch: string }>(token, 'GET', `/repos/${owner}/${repo}`)
    const base = info.default_branch
    const ref = await this.call<{ object: { sha: string } }>(token, 'GET', `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`)
    const baseSha = ref.object.sha
    const commit = await this.call<{ tree: { sha: string } }>(token, 'GET', `/repos/${owner}/${repo}/git/commits/${baseSha}`)

    const tree: { path: string; mode: '100644'; type: 'blob'; content?: string; sha?: null }[] = []
    for (const file of files) {
      let original: string | null = null
      if (file.oldPath) {
        const content = await this.call<{ content: string; encoding: string }>(
          token, 'GET', `/repos/${owner}/${repo}/contents/${file.oldPath.split('/').map(encodeURIComponent).join('/')}?ref=${baseSha}`,
        )
        const bin = atob(content.content.replace(/\n/g, ''))
        original = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
      }
      const updated = applyFilePatch(original, file)
      if (file.oldPath && file.newPath !== file.oldPath) tree.push({ path: file.oldPath, mode: '100644', type: 'blob', sha: null })
      if (updated !== null && file.newPath) tree.push({ path: file.newPath, mode: '100644', type: 'blob', content: updated })
    }

    const newTree = await this.call<{ sha: string }>(token, 'POST', `/repos/${owner}/${repo}/git/trees`, { base_tree: commit.tree.sha, tree })
    const message = `[${input.localId}] ${input.title}\n\nVolunteer: ${input.volunteer}, through the volunteer compute broker\nVolunteer-Task: ${input.taskId}`
    const created = await this.call<{ sha: string }>(token, 'POST', `/repos/${owner}/${repo}/git/commits`, {
      message,
      tree: newTree.sha,
      parents: [baseSha],
      author: { name: `${input.volunteer} (volunteer)`, email: 'volunteers@volunteer.apishelf.dev' },
    })
    const branch = `volunteer/${input.localId}-${created.sha.slice(0, 7)}`
    await this.call(token, 'POST', `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: created.sha })
    const body = [
      `**Volunteer task:** \`${input.localId}\` — ${input.title}`,
      `**Volunteer:** ${input.volunteer}`,
      '',
      ...(input.record ? [input.record.slice(0, 60_000)] : ['### What the volunteer reports', '', input.summary.slice(0, 60_000)]),
      '',
      '**Merging this pull request marks the task done on [volunteer.apishelf.dev](https://volunteer.apishelf.dev/). Closing it without merging sends the task back to the pool.**',
      '',
      `<!-- volunteer-task: ${input.taskId} -->`,
    ].join('\n')
    const pr = await this.call<{ html_url: string }>(token, 'POST', `/repos/${owner}/${repo}/pulls`, {
      title: `[${input.localId}] ${input.title}`,
      head: branch,
      base,
      body,
    })
    return pr.html_url
  }
}

export function taskIdFromPrBody(body: string | null | undefined): string | null {
  const match = body?.match(/<!-- volunteer-task: ([^\s]+) -->/)
  return match ? match[1]! : null
}

export function appManifest(origin: string) {
  return {
    name: 'Volunteer Compute Broker',
    url: origin,
    description: 'Turns volunteer AI work on vetted nonprofit tasks into pull requests. Merging marks the task done.',
    hook_attributes: { url: `${origin}/github/webhook`, active: true },
    redirect_url: `${origin}/setup/github/callback`,
    public: true,
    default_permissions: { contents: 'write', pull_requests: 'write', metadata: 'read', checks: 'read' },
    default_events: ['pull_request', 'pull_request_review', 'check_suite'],
  }
}
