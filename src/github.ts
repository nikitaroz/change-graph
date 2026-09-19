import type { ChangedFile, PullRequestInfo } from './types'

const PR_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i

export function parsePrUrl(input: string): { owner: string; repo: string; number: number } | null {
  const m = input.trim().match(PR_RE)
  if (!m) return null
  return { owner: m[1], repo: m[2], number: Number(m[3]) }
}

const HEADERS: HeadersInit = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
}

async function gh<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

/** The files endpoint is paginated at 100; a single request silently drops the rest. */
async function ghPages<T>(url: string): Promise<T[]> {
  const out: T[] = []
  const sep = url.includes('?') ? '&' : '?'
  for (let page = 1; ; page++) {
    const chunk = await gh<T[]>(`${url}${sep}page=${page}`)
    out.push(...chunk)
    // GitHub caps this endpoint at 3000 files (30 pages of 100).
    if (chunk.length < 100 || page >= 30) break
  }
  return out
}

function encodeRepoPath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/')
}

type GhPr = {
  title: string
  body: string | null
  html_url: string
  base: { sha: string; ref: string }
  head: { sha: string; ref: string }
}

type GhFile = {
  filename: string
  status: string
  additions: number
  deletions: number
  previous_filename?: string
}

export async function fetchPullRequest(
  owner: string,
  repo: string,
  number: number,
): Promise<{ pr: PullRequestInfo; files: ChangedFile[] }> {
  const pr = await gh<GhPr>(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`)
  const files = await ghPages<GhFile>(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`,
  )

  const info: PullRequestInfo = {
    owner,
    repo,
    number,
    title: pr.title,
    description: pr.body ?? undefined,
    url: pr.html_url,
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
    baseRef: pr.base.ref,
    headRef: pr.head.ref,
  }

  const changed: ChangedFile[] = await Promise.all(
    files.map(async (f) => {
      // A missing side is normal (added/removed files); anything else — rate limits
      // above all — must not be mistaken for "this file has no symbols", which would
      // silently report every symbol in it as added or removed.
      const raw = async (sha: string, path: string) => {
        const url = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${encodeRepoPath(path)}`
        const res = await fetch(url)
        if (res.status === 404) return undefined
        if (!res.ok) {
          throw new Error(`Could not read ${path} at ${sha.slice(0, 7)} (HTTP ${res.status})`)
        }
        return res.text()
      }
      const basePath = f.previous_filename ?? f.filename
      // Copied files did not exist at base; fetching the source path would make
      // every symbol look modified instead of added.
      const skipBase = f.status === 'added' || f.status === 'copied'
      const [baseContent, headContent] = await Promise.all([
        skipBase ? Promise.resolve(undefined) : raw(info.baseSha, basePath),
        f.status === 'removed' ? Promise.resolve(undefined) : raw(info.headSha, f.filename),
      ])
      return {
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        previousFilename: f.previous_filename,
        baseContent,
        headContent,
      }
    }),
  )

  return { pr: info, files: changed }
}
