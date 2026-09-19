import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { diffLines } from 'diff'
import { GitPullRequest, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import Markdown, { type Components } from 'react-markdown'
import { Group, Panel, Separator, usePanelRef, type Layout } from 'react-resizable-panels'
import remarkGfm from 'remark-gfm'
import { fetchPullRequest, parsePrUrl } from './github'
import { buildChangeGraph } from './pipeline'
import { TreeView } from './components/TreeView'
import { CORE_CHANGES as CORE } from './palette'
import type { ChangeGraph, ChangeKind, SymbolNode } from './types'

const PANEL_LAYOUT_KEY = 'change-graph:panel-layout-v2'
const DEFAULT_PANEL_LAYOUT: Layout = { sidebar: 22, tree: 50, details: 28 }

function loadPanelLayout(): Layout {
  try {
    const layout = JSON.parse(localStorage.getItem(PANEL_LAYOUT_KEY) ?? '')
    if (
      typeof layout.sidebar === 'number' &&
      typeof layout.tree === 'number' &&
      typeof layout.details === 'number'
    ) {
      return layout
    }
  } catch {
    // Use the balanced default when no valid preference has been saved.
  }
  return DEFAULT_PANEL_LAYOUT
}

function savePanelLayout(layout: Layout) {
  try {
    localStorage.setItem(PANEL_LAYOUT_KEY, JSON.stringify(layout))
  } catch {
    // Resizing should continue to work when storage is unavailable.
  }
}

/** Back/forward trail. Kept as one value so the index can never drift from the entries. */
type Trail = { entries: string[]; index: number }
const EMPTY_TRAIL: Trail = { entries: [], index: -1 }

function badge(kind: ChangeKind) {
  return <span className={`badge ${kind}`}>{kind}</span>
}

type DiffRow = {
  sign: '+' | '-' | ' '
  cls: string
  text: string
  /** Absolute file lines, blank on the side where the row does not exist. */
  baseNo?: number
  headNo?: number
}

/** A trailing newline closes the last line rather than starting a new one. */
function splitLines(value: string): string[] {
  const lines = value.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** `diffLines` hands back multi-line chunks; review needs a marker per line. */
function diffRows(node: SymbolNode): DiffRow[] {
  const rows: DiffRow[] = []
  let baseNo = node.spanBase?.startLine ?? 1
  let headNo = node.spanHead?.startLine ?? 1
  for (const chunk of diffLines(node.bodyBase ?? '', node.bodyHead ?? '')) {
    for (const text of splitLines(chunk.value)) {
      if (chunk.added) rows.push({ sign: '+', cls: 'add', text, headNo: headNo++ })
      else if (chunk.removed) rows.push({ sign: '-', cls: 'del', text, baseNo: baseNo++ })
      else rows.push({ sign: ' ', cls: '', text, baseNo: baseNo++, headNo: headNo++ })
    }
  }
  return rows
}

/**
 * `https://github.com/<owner>/<repo>/blob/<sha>/<path>#L` for each side, ready to
 * have a line number appended. Undefined when the PR metadata can't place the file.
 */
function blobPrefixes(graph: ChangeGraph, node: SymbolNode) {
  const { owner, repo, baseSha, headSha } = graph.pr
  if (!owner || !repo) return {}
  // Base content lives under the old path when the PR renamed the file.
  const changed = graph.files.find((f) => f.filename === node.file)
  const at = (sha?: string, path?: string) =>
    sha && path
      ? `https://github.com/${owner}/${repo}/blob/${sha}/${path.split('/').map(encodeURIComponent).join('/')}#L`
      : undefined
  return {
    base: at(baseSha, changed?.previousFilename ?? node.file),
    head: at(headSha, node.file),
  }
}

function LineNo({ no, prefix }: { no?: number; prefix?: string }) {
  if (no == null) return <span className="ln" />
  if (!prefix) return <span className="ln">{no}</span>
  return (
    <a
      className="ln"
      href={`${prefix}${no}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open line ${no} on GitHub`}
    >
      {no}
    </a>
  )
}

function prepareMarkdown(description?: string) {
  return description?.replace(/<!--[\s\S]*?-->/g, '').trim()
}

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
}

function PrDescription({ markdown }: { markdown: string }) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    setExpanded(false)
  }, [markdown])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      if (expanded) return
      setOverflows(el.scrollHeight > el.clientHeight + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [markdown, expanded])

  return (
    <div className="pr-description">
      <div ref={ref} className={`pr-markdown ${expanded ? 'is-expanded' : ''}`}>
        <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {markdown}
        </Markdown>
      </div>
      {(overflows || expanded) && (
        <button type="button" className="pr-expand" onClick={() => setExpanded((open) => !open)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

function neighbors(graph: ChangeGraph, id: string) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const callers: { node: SymbolNode; kind: string }[] = []
  const callees: { node: SymbolNode; kind: string }[] = []
  for (const e of graph.edges) {
    if (e.kind === 'contains' || e.kind === 'invokes') continue
    if (e.to === id) {
      const n = byId.get(e.from)
      if (n && n.language === 'python') callers.push({ node: n, kind: e.kind })
    }
    if (e.from === id) {
      const n = byId.get(e.to)
      if (n && n.language === 'python') callees.push({ node: n, kind: e.kind })
    }
  }
  return { callers, callees }
}

function Details({
  graph,
  node,
  onSelect,
}: {
  graph: ChangeGraph
  node?: SymbolNode
  onSelect: (id: string) => void
}) {
  if (!node) {
    return (
      <div className="pane details">
        <h2>Symbol</h2>
        <p className="empty">Click a row, or press j to walk the review order.</p>
      </div>
    )
  }

  const findings = graph.checks.filter((c) => c.symbolId === node.id)
  const nb = neighbors(graph, node.id)
  const rows = diffRows(node)
  const blob = blobPrefixes(graph, node)
  const twoSided = node.bodyBase != null && node.bodyHead != null
  // One-sided symbols carry only the side they exist on.
  const solePrefix = node.bodyHead != null ? blob.head : blob.base
  // Size the gutter to the widest number so the code column never jitters.
  const widest = rows.reduce((w, r) => Math.max(w, r.baseNo ?? 0, r.headNo ?? 0), 0)
  const lnDigits = Math.max(2, String(widest).length)

  return (
    <div className="pane details">
      <h2>Symbol</h2>
      <div className="detail-head">
        <div className="qname big">{node.qname}</div>
        <div className="detail-meta">
          {badge(node.change)}
          <span>{node.kind}</span>
        </div>
        {node.note && <div className="note">{node.note}</div>}
      </div>

      <div className="diff" style={{ '--ln': `${lnDigits}ch` } as CSSProperties}>
        {rows.map((r, i) => (
          <div key={i} className={`line ${r.cls}`}>
            {twoSided ? (
              <>
                <LineNo no={r.baseNo} prefix={blob.base} />
                <LineNo no={r.headNo} prefix={blob.head} />
              </>
            ) : (
              <LineNo no={r.baseNo ?? r.headNo} prefix={solePrefix} />
            )}
            <span className="code">{r.sign + r.text}</span>
          </div>
        ))}
      </div>

      {findings.length > 0 && (
        <>
          <h2>Checks</h2>
          <ul className="rel-list">
            {findings.map((c, i) => (
              <li key={`${c.type}-${i}`}>
                <div className={`check-card ${c.type}`}>
                  <span className="hint">{c.type}</span>
                  <span>{c.message}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Callers</h2>
      <ul className="rel-list">
        {nb.callers.length === 0 && <li className="empty">None found</li>}
        {nb.callers.map(({ node: n, kind }) => (
          <li key={n.id}>
            <button className="rel-card" onClick={() => onSelect(n.id)}>
              {badge(n.change)} <span className="qname">{n.qname}</span>
              <span className="hint">{kind}</span>
            </button>
          </li>
        ))}
      </ul>

      <h2>Callees</h2>
      <ul className="rel-list">
        {nb.callees.length === 0 && <li className="empty">None found</li>}
        {nb.callees.map(({ node: n, kind }) => (
          <li key={n.id}>
            <button className="rel-card" onClick={() => onSelect(n.id)}>
              {badge(n.change)} <span className="qname">{n.qname}</span>
              <span className="hint">{kind}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function App() {
  const params = new URLSearchParams(window.location.search)
  const panelLayout = useMemo(loadPanelLayout, [])
  const [prUrl, setPrUrl] = useState(params.get('pr') ?? '')
  const [graph, setGraph] = useState<ChangeGraph>()
  const [status, setStatus] = useState('Idle')
  const [error, setError] = useState<string>()
  const [selected, setSelected] = useState<string>()
  const [trail, setTrail] = useState<Trail>(EMPTY_TRAIL)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const sidebarRef = usePanelRef()
  const loadRun = useRef(0)

  const select = useCallback((id: string) => {
    setSelected(id)
    setTrail((t) => {
      if (t.entries[t.index] === id) return t
      const entries = [...t.entries.slice(0, t.index + 1), id]
      return { entries, index: entries.length - 1 }
    })
  }, [])

  const step = useCallback(
    (delta: number) => {
      const index = trail.index + delta
      if (index < 0 || index >= trail.entries.length) return
      setTrail({ entries: trail.entries, index })
      setSelected(trail.entries[index])
    },
    [trail],
  )

  const pythonOrder = useMemo(() => {
    if (!graph) return []
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    return graph.reviewOrder.filter((id) => {
      const n = byId.get(id)
      return n && n.language === 'python' && CORE.has(n.change)
    })
  }, [graph])

  const loadFromParts = useCallback(
    async (loader: () => Promise<{ pr: ChangeGraph['pr']; files: ChangeGraph['files'] }>) => {
      // Only the newest load may touch state; an earlier one finishing later must not win.
      const run = ++loadRun.current
      const current = () => run === loadRun.current
      setError(undefined)
      setStatus('Fetching…')
      try {
        const { pr, files } = await loader()
        if (!current()) return
        setStatus(`Parsing ${files.length} files…`)
        const g = await buildChangeGraph(pr, files)
        if (!current()) return
        setGraph(g)
        const first = g.reviewOrder.find((id) => {
          const n = g.nodes.find((x) => x.id === id)
          return n?.language === 'python'
        })
        setTrail(first ? { entries: [first], index: 0 } : EMPTY_TRAIL)
        setSelected(first)
        const changed = g.nodes.filter(
          (n) => n.language === 'python' && n.kind !== 'module' && CORE.has(n.change),
        ).length
        setStatus(`${pr.title} · ${changed} changed Python symbols`)
      } catch (e) {
        if (!current()) return
        setError(e instanceof Error ? e.message : String(e))
        setStatus('Failed')
      }
    },
    [],
  )

  const loadPr = useCallback(async () => {
    const parsed = parsePrUrl(prUrl)
    if (!parsed) {
      setError('Paste a GitHub pull request URL')
      return
    }
    await loadFromParts(() => fetchPullRequest(parsed.owner, parsed.repo, parsed.number))
  }, [prUrl, loadFromParts])

  /**
   * Enter reloads the page at `?pr=…` rather than swapping the graph in place, so a new
   * pull request starts from clean state instead of inheriting the previous one's
   * selection, trail, and tree expansion.
   */
  const submitPr = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      const parsed = parsePrUrl(prUrl)
      if (!parsed) {
        setError('Paste a GitHub pull request URL')
        return
      }
      // Pasted links often carry a tab suffix like /files or /changes; store the canonical form.
      const next = new URL(window.location.href)
      next.searchParams.set('pr', `https://github.com/${parsed.owner}/${parsed.repo}/pull/${parsed.number}`)
      window.location.assign(next)
    },
    [prUrl],
  )

  useEffect(() => {
    if (params.get('pr')) loadPr()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (!graph) return
      if (e.key === 'j' || e.key === 'k') {
        const idx = selected ? pythonOrder.indexOf(selected) : -1
        const next = e.key === 'j' ? Math.min(pythonOrder.length - 1, idx + 1) : Math.max(0, idx - 1)
        if (pythonOrder[next]) select(pythonOrder[next])
      }
      if (e.key === ']') step(1)
      if (e.key === '[') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [graph, selected, step, select, pythonOrder])

  const node = graph?.nodes.find((n) => n.id === selected)
  const description = prepareMarkdown(graph?.pr.description)
  const graphStatus = graph ? status.replace(`${graph.pr.title} · `, '') : status
  const repoUrl = graph ? `https://github.com/${graph.pr.owner}/${graph.pr.repo}` : undefined

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <GitPullRequest aria-hidden="true" />
          </span>
          <span className="brand-copy">
            <strong>Change graph</strong>
            <small>Semantic review</small>
          </span>
        </div>
        <form className="pr-form" onSubmit={submitPr}>
          <label className="input-shell pr-shell">
            <GitPullRequest aria-hidden="true" />
            <input
              className="pr"
              type="text"
              value={prUrl}
              onChange={(e) => setPrUrl(e.target.value)}
              placeholder="GitHub PR URL — press Enter to load"
              aria-label="GitHub PR URL"
            />
          </label>
        </form>
      </header>

      <div className="status">
        <span className={`status-dot ${error ? 'has-error' : ''}`} />
        <span className="status-copy">
          {graph ? `${graph.pr.owner}/${graph.pr.repo} #${graph.pr.number} · ${graphStatus}` : graphStatus}
          {error && <span className="error">{error}</span>}
        </span>
      </div>

      <div className={`panes ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
        {graph ? (
          <Group
            className="workspace"
            defaultLayout={panelLayout}
            id="review-workspace"
            onLayoutChanged={(layout, { isUserInteraction }) => {
              if (isUserInteraction) savePanelLayout(layout)
            }}
            orientation="horizontal"
          >
            <Panel
              className="sidebar-panel"
              collapsedSize="44px"
              collapsible
              defaultSize="244px"
              id="sidebar"
              maxSize="45%"
              minSize="180px"
              panelRef={sidebarRef}
              onResize={() => {
                setSidebarOpen(!sidebarRef.current?.isCollapsed())
              }}
            >
              <div className="pane sidebar">
                <button
                  className="sidebar-toggle"
                  type="button"
                  aria-label={sidebarOpen ? 'Collapse PR sidebar' : 'Expand PR sidebar'}
                  aria-pressed={!sidebarOpen}
                  onClick={() => {
                    if (sidebarRef.current?.isCollapsed()) sidebarRef.current.expand()
                    else sidebarRef.current?.collapse()
                  }}
                >
                  {sidebarOpen ? (
                    <PanelLeftClose aria-hidden="true" />
                  ) : (
                    <PanelLeftOpen aria-hidden="true" />
                  )}
                </button>
                <div className="pr-context">
                  <span className="pr-eyebrow">
                    <a href={repoUrl} target="_blank" rel="noreferrer">
                      {graph.pr.owner}/{graph.pr.repo}
                    </a>
                    {' · '}#{graph.pr.number}
                  </span>
                  <h1>
                    <a href={graph.pr.url} target="_blank" rel="noreferrer">
                      {graph.pr.title}
                    </a>
                  </h1>
                  {description && <PrDescription markdown={description} />}
                </div>
              </div>
            </Panel>
            <Separator className="resize-handle" />
            <Panel className="tree-panel" id="tree" minSize="280px">
              <TreeView graph={graph} selected={selected} onSelect={select} />
            </Panel>
            <Separator className="resize-handle" />
            <Panel className="details-panel" id="details" minSize="240px" maxSize="50%">
              <Details graph={graph} node={node} onSelect={select} />
            </Panel>
          </Group>
        ) : (
          <p className="empty pad">Loading a pull request turns files into a tree of symbols.</p>
        )}
      </div>
    </div>
  )
}
