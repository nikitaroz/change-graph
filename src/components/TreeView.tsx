import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { CHANGE_COLOR, CORE_CHANGES, strongestChange } from '../palette'
import type { ChangeGraph, ChangeKind, SymbolNode } from '../types'

const CHANGE_MARK: Record<ChangeKind, string> = {
  added: 'added',
  modified: 'mod',
  moved: 'moved',
  removed: 'removed',
  'unchanged-affected': 'affected',
  unchanged: '',
}

/** Files with more symbols than this stay folded when nothing inside them changed. */
const AUTO_OPEN_LIMIT = 60

type RowKind = 'dir' | 'file' | 'symbol'

type Row = {
  key: string
  kind: RowKind
  /** Dimmed path prefix, used when a single-child directory chain is collapsed into one row. */
  prefix?: string
  label: string
  /** `class` or `def`, so a row reads like the source it came from. */
  keyword?: string
  signature?: string
  /** Strongest change in this row's subtree — drives colour on containers. */
  change: ChangeKind
  own: ChangeKind
  symbol?: SymbolNode
  file?: string
  delta?: string
  /** Subtree counts, precomputed so filtering stays O(1) per row. */
  focus: number
  changed: number
  total: number
  search: string
  children: Row[]
}

type Flat = {
  row: Row
  depth: number
  /** One entry per ancestor level: true when that level still has siblings below. */
  guides: boolean[]
  last: boolean
  expandable: boolean
  expanded: boolean
}

function lineOf(n: SymbolNode) {
  return n.spanHead?.startLine ?? n.spanBase?.startLine ?? 0
}

function countLines(text: string) {
  const trimmed = text.replace(/\n+$/, '')
  return trimmed ? trimmed.split('\n').length : 0
}

function deltaOf(n: SymbolNode): string | undefined {
  const head = n.bodyHead ? countLines(n.bodyHead) : 0
  const base = n.bodyBase ? countLines(n.bodyBase) : 0
  // One-sided symbols only carry a body on the side they exist on.
  if (n.change === 'added') return `+${head}`
  if (n.change === 'removed') return `−${base}`
  const net = head - base
  if (n.change === 'modified' && net !== 0) return net > 0 ? `+${net}` : `−${-net}`
  return undefined
}

function paramsOf(n: SymbolNode): string | undefined {
  const sig = n.signatureHead ?? n.signatureBase
  if (!sig) return undefined
  const open = sig.indexOf('(')
  if (open === -1) return undefined
  const close = sig.lastIndexOf(')')
  // Annotated parameters can cut the captured signature short of its closing paren.
  const inner =
    close > open
      ? sig.slice(open, close + 1)
      : `${sig.slice(open).replace(/[\s:,]+$/, '')} …)`
  const tidy = inner.replace(/\s+/g, ' ')
  return tidy.length > 56 ? `${tidy.slice(0, 55)}…)` : tidy
}

function keywordOf(n: SymbolNode) {
  return n.kind === 'class' ? 'class' : 'def'
}

function pushInto<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/**
 * Resolve the enclosing symbol for `n`, preferring the parser's `parentQname` and
 * falling back to the dotted prefix of the qualified name. Duplicate qnames (a
 * removed and an added symbol sharing a name) are disambiguated by span.
 */
function pickParent(n: SymbolNode, byQname: Map<string, SymbolNode[]>) {
  const keys: string[] = []
  if (n.parentQname) keys.push(n.parentQname)
  const parts = n.qname.split('.')
  if (parts.length > 1) keys.push(parts.slice(0, -1).join('.'))
  for (const key of keys) {
    const candidates = (byQname.get(key) ?? []).filter((c) => c.id !== n.id)
    if (candidates.length === 0) continue
    if (candidates.length === 1) return candidates[0]
    const line = lineOf(n)
    const enclosing = candidates.find((c) => {
      const span = c.spanHead ?? c.spanBase
      return span && span.startLine <= line && line <= span.endLine
    })
    return enclosing ?? candidates[0]
  }
  return undefined
}

function symbolForest(nodes: SymbolNode[]): Row[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const byQname = new Map<string, SymbolNode[]>()
  for (const n of nodes) pushInto(byQname, n.qname, n)

  const parentOf = new Map<string, string>()
  for (const n of nodes) {
    const parent = pickParent(n, byQname)
    if (parent) parentOf.set(n.id, parent.id)
  }
  // Duplicate qnames can in principle produce a loop; break any we find.
  for (const n of nodes) {
    const seen = new Set([n.id])
    let cur = parentOf.get(n.id)
    while (cur) {
      if (seen.has(cur)) {
        parentOf.delete(n.id)
        break
      }
      seen.add(cur)
      cur = parentOf.get(cur)
    }
  }

  const childrenOf = new Map<string, SymbolNode[]>()
  const roots: SymbolNode[] = []
  for (const n of nodes) {
    const parent = parentOf.get(n.id)
    if (parent && byId.has(parent)) pushInto(childrenOf, parent, n)
    else roots.push(n)
  }

  const bySource = (a: SymbolNode, b: SymbolNode) =>
    lineOf(a) - lineOf(b) || a.qname.localeCompare(b.qname)

  const toRow = (n: SymbolNode): Row => {
    const children = (childrenOf.get(n.id) ?? []).sort(bySource).map(toRow)
    const label = n.qname.split('.').pop() ?? n.qname
    let change = n.change
    let focus = CORE_CHANGES.has(n.change) ? 1 : 0
    let changed = CORE_CHANGES.has(n.change) ? 1 : 0
    let total = 1
    for (const c of children) {
      change = strongestChange(change, c.change)
      focus += c.focus
      changed += c.changed
      total += c.total
    }
    return {
      key: `s:${n.id}`,
      kind: 'symbol',
      label,
      keyword: keywordOf(n),
      signature: paramsOf(n),
      change,
      own: n.change,
      symbol: n,
      file: n.file,
      delta: deltaOf(n),
      focus,
      changed,
      total,
      search: `${n.qname} ${n.file}`.toLowerCase(),
      children,
    }
  }

  return roots.sort(bySource).map(toRow)
}

function rollUp(
  key: string,
  kind: RowKind,
  label: string,
  children: Row[],
  extra: Partial<Row> = {},
): Row {
  let change: ChangeKind = 'unchanged'
  let focus = 0
  let changed = 0
  let total = 0
  for (const c of children) {
    change = strongestChange(change, c.change)
    focus += c.focus
    changed += c.changed
    total += c.total
  }
  return {
    key,
    kind,
    label,
    change,
    own: change,
    focus,
    changed,
    total,
    search: label.toLowerCase(),
    children,
    ...extra,
  }
}

type DirNode = { name: string; children: Map<string, DirNode>; files: Row[] }

function emptyDir(name: string): DirNode {
  return { name, children: new Map(), files: [] }
}

/**
 * Turn file rows into a directory tree, collapsing single-child directory chains
 * the way a file explorer does (`scripts/publish` instead of two rows).
 */
function directoryTree(files: { path: string; row: Row }[]): Row[] {
  const root = emptyDir('')
  for (const { path, row } of files) {
    const segments = path.split('/')
    let cur = root
    for (const segment of segments.slice(0, -1)) {
      let next = cur.children.get(segment)
      if (!next) {
        next = emptyDir(segment)
        cur.children.set(segment, next)
      }
      cur = next
    }
    cur.files.push(row)
  }

  const byLabel = (a: Row, b: Row) => a.label.localeCompare(b.label)

  const emit = (dir: DirNode, path: string, label: string): Row => {
    let node = dir
    let fullPath = path
    let fullLabel = label
    while (node.files.length === 0 && node.children.size === 1) {
      const only = [...node.children.values()][0]
      fullPath = `${fullPath}/${only.name}`
      fullLabel = `${fullLabel}/${only.name}`
      node = only
    }
    const dirs = [...node.children.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((child) => emit(child, `${fullPath}/${child.name}`, child.name))
    const own = [...node.files].sort(byLabel)
    // A directory holding exactly one file reads better as a single path row.
    if (dirs.length === 0 && own.length === 1) {
      return { ...own[0], prefix: `${fullLabel}/` }
    }
    return rollUp(`d:${fullPath}`, 'dir', fullLabel, [...dirs, ...own], {
      search: fullPath.toLowerCase(),
    })
  }

  const topDirs = [...root.children.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((child) => emit(child, child.name, child.name))
  return [...topDirs, ...[...root.files].sort(byLabel)]
}

function buildTree(graph: ChangeGraph) {
  const python = graph.nodes.filter((n) => n.language === 'python' && n.kind !== 'module')
  const byFile = new Map<string, SymbolNode[]>()
  for (const n of python) pushInto(byFile, n.file, n)

  const fileStats = new Map(
    graph.files.flatMap((f) => {
      const stat = { additions: f.additions, deletions: f.deletions }
      return f.previousFilename
        ? [
            [f.filename, stat] as const,
            [f.previousFilename, stat] as const,
          ]
        : [[f.filename, stat] as const]
    }),
  )

  const files = [...byFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, nodes]) => {
      const stat = fileStats.get(path)
      const row = rollUp(`f:${path}`, 'file', path.split('/').pop() ?? path, symbolForest(nodes), {
        file: path,
        search: path.toLowerCase(),
        delta:
          stat && (stat.additions || stat.deletions)
            ? `+${stat.additions} −${stat.deletions}`
            : undefined,
      })
      return { path, row }
    })

  const roots = directoryTree(files)

  // Ancestor chain per symbol, so selecting a node can reveal it.
  const ancestors = new Map<string, string[]>()
  const walk = (rows: Row[], chain: string[]) => {
    for (const row of rows) {
      if (row.symbol) ancestors.set(row.symbol.id, chain)
      if (row.children.length) walk(row.children, [...chain, row.key])
    }
  }
  walk(roots, [])

  return { roots, ancestors, fileCount: files.length, symbolCount: python.length }
}

function defaultExpanded(row: Row) {
  if (row.kind === 'dir') return true
  if (row.kind === 'file') return row.focus > 0 || row.total <= AUTO_OPEN_LIMIT
  return row.focus > 0
}

export function TreeView({
  graph,
  selected,
  onSelect,
}: {
  graph: ChangeGraph
  selected?: string
  onSelect: (id: string) => void
}) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [bulk, setBulk] = useState<boolean | null>(null)
  const [changedOnly, setChangedOnly] = useState(true)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState<string>()
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const focusNext = useRef<string | undefined>(undefined)

  const { roots, ancestors, fileCount, symbolCount } = useMemo(
    () => buildTree(graph),
    [graph],
  )

  useEffect(() => {
    setOverrides({})
    setBulk(null)
    setCursor(undefined)
  }, [graph])

  // Reveal the selected symbol, then let the user fold it away again.
  useEffect(() => {
    if (!selected) return
    const chain = ancestors.get(selected)
    if (!chain?.length) return
    setOverrides((prev) => {
      const missing = chain.filter((key) => prev[key] !== true)
      if (!missing.length) return prev
      const next = { ...prev }
      for (const key of missing) next[key] = true
      return next
    })
  }, [selected, ancestors])

  const needle = query.trim().toLowerCase()
  const matched = useMemo(() => {
    if (!needle) return null
    const keep = new Set<string>()
    const walk = (row: Row): boolean => {
      let hit = row.search.includes(needle)
      for (const child of row.children) if (walk(child)) hit = true
      if (hit) keep.add(row.key)
      return hit
    }
    for (const row of roots) walk(row)
    return keep
  }, [roots, needle])

  const selectedPath = useMemo(() => {
    if (!selected) return new Set<string>()
    return new Set([`s:${selected}`, ...(ancestors.get(selected) ?? [])])
  }, [selected, ancestors])

  const linked = useMemo(() => {
    const map = new Map<string, 'in' | 'out' | 'both'>()
    if (!selected) return map
    const mark = (id: string, dir: 'in' | 'out') => {
      const prev = map.get(id)
      map.set(id, prev && prev !== dir ? 'both' : dir)
    }
    for (const e of graph.edges) {
      if (e.kind === 'contains' || e.kind === 'invokes') continue
      if (e.from === selected) mark(e.to, 'out')
      if (e.to === selected) mark(e.from, 'in')
    }
    map.delete(selected)
    return map
  }, [graph, selected])

  const flat = useMemo(() => {
    const keep = (row: Row) => {
      if (matched && !matched.has(row.key)) return false
      if (changedOnly && row.focus === 0 && !selectedPath.has(row.key)) return false
      return true
    }
    const isOpen = (row: Row) => {
      if (matched) return true
      return overrides[row.key] ?? bulk ?? defaultExpanded(row)
    }
    const out: Flat[] = []
    const visit = (rows: Row[], depth: number, guides: boolean[]) => {
      const shown = rows.filter(keep)
      shown.forEach((row, i) => {
        const last = i === shown.length - 1
        const expandable = row.children.some(keep)
        const expanded = expandable && isOpen(row)
        out.push({ row, depth, guides, last, expandable, expanded })
        if (expanded) visit(row.children, depth + 1, [...guides, !last])
      })
    }
    visit(roots, 0, [])
    return out
  }, [roots, matched, changedOnly, selectedPath, overrides, bulk])

  const toggle = useCallback((row: Row, open: boolean) => {
    setOverrides((prev) => ({ ...prev, [row.key]: open }))
  }, [])

  const activate = useCallback(
    (f: Flat) => {
      setCursor(f.row.key)
      if (f.row.symbol) onSelect(f.row.symbol.id)
      if (f.expandable) toggle(f.row, !f.expanded)
    },
    [onSelect, toggle],
  )

  const cursorKey = useMemo(() => {
    if (cursor && flat.some((f) => f.row.key === cursor)) return cursor
    if (selected && flat.some((f) => f.row.key === `s:${selected}`)) return `s:${selected}`
    return flat[0]?.row.key
  }, [cursor, selected, flat])

  // Keep the active row on screen for j/k review and arrow navigation.
  useEffect(() => {
    if (!selected) return
    rowRefs.current.get(`s:${selected}`)?.scrollIntoView({ block: 'nearest' })
  }, [selected, flat])

  useEffect(() => {
    if (!focusNext.current) return
    const el = rowRefs.current.get(focusNext.current)
    focusNext.current = undefined
    el?.focus({ preventScroll: true })
    el?.scrollIntoView({ block: 'nearest' })
  }, [flat, cursorKey])

  const move = useCallback(
    (key: string) => {
      focusNext.current = key
      setCursor(key)
      const next = flat.find((f) => f.row.key === key)
      if (next?.row.symbol) onSelect(next.row.symbol.id)
    },
    [flat, onSelect],
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const index = flat.findIndex((f) => f.row.key === cursorKey)
      if (index === -1) return
      const current = flat[index]
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const next = flat[index + (event.key === 'ArrowDown' ? 1 : -1)]
        if (!next) return
        event.preventDefault()
        move(next.row.key)
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (current.expandable && !current.expanded) toggle(current.row, true)
        else if (current.expanded) move(flat[index + 1]?.row.key ?? current.row.key)
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        if (current.expanded) {
          toggle(current.row, false)
          return
        }
        for (let i = index - 1; i >= 0; i--) {
          if (flat[i].depth < current.depth) {
            move(flat[i].row.key)
            return
          }
        }
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        activate(current)
      }
    },
    [flat, cursorKey, move, toggle, activate],
  )

  const shownChanged = flat.reduce((acc, f) => acc + (f.row.kind === 'symbol' && CORE_CHANGES.has(f.row.own) ? 1 : 0), 0)

  return (
    <div className="pane tree-pane">
      <div className="tree-toolbar">
        <input
          className="tree-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter symbols…"
        />
        <label className="tree-check">
          <input
            type="checkbox"
            checked={changedOnly}
            onChange={(e) => setChangedOnly(e.target.checked)}
          />
          Changed only
        </label>
        <button
          onClick={() => {
            setOverrides({})
            setBulk(true)
          }}
        >
          Expand all
        </button>
        <button
          onClick={() => {
            setOverrides({})
            setBulk(false)
          }}
        >
          Collapse all
        </button>
        <span className="tree-stat">
          {fileCount} {fileCount === 1 ? 'file' : 'files'} · {symbolCount} symbols · {shownChanged} changed shown
        </span>
      </div>

      <div className="tree-scroll">
        {flat.length === 0 ? (
          <p className="empty pad">
            {symbolCount === 0
              ? 'No Python symbols in this pull request.'
              : 'Nothing matches the current filters.'}
          </p>
        ) : (
          <div className="tree" role="tree" aria-label="Changed Python symbols" onKeyDown={onKeyDown}>
            {flat.map((f) => {
              const { row } = f
              const color = CHANGE_COLOR[row.kind === 'symbol' ? row.own : row.change]
              const isSelected = row.symbol?.id === selected
              const link = row.symbol ? linked.get(row.symbol.id) : undefined
              const classes = [
                'tree-row',
                `tree-${row.kind}`,
                CORE_CHANGES.has(row.kind === 'symbol' ? row.own : row.change) ? 'core' : '',
                isSelected ? 'selected' : '',
                link ? 'linked' : '',
              ]
                .filter(Boolean)
                .join(' ')

              return (
                <div
                  key={row.key}
                  ref={(el) => {
                    if (el) rowRefs.current.set(row.key, el)
                    else rowRefs.current.delete(row.key)
                  }}
                  className={classes}
                  style={{ '--c': color } as CSSProperties}
                  role="treeitem"
                  aria-level={f.depth + 1}
                  aria-selected={isSelected}
                  aria-expanded={f.expandable ? f.expanded : undefined}
                  tabIndex={row.key === cursorKey ? 0 : -1}
                  title={
                    row.symbol
                      ? `${row.symbol.qname} — ${row.own}`
                      : `${row.file ?? row.label} — ${row.changed} changed of ${row.total} symbols`
                  }
                  onClick={() => activate(f)}
                  onFocus={() => setCursor(row.key)}
                >
                  {f.guides.map((on, i) => (
                    <span key={i} className={on ? 'tree-guide on' : 'tree-guide'} />
                  ))}
                  {f.depth > 0 && <span className={f.last ? 'tree-elbow last' : 'tree-elbow'} />}

                  {f.expandable ? (
                    <span
                      className="tree-twisty"
                      role="presentation"
                      onClick={(e) => {
                        e.stopPropagation()
                        setCursor(row.key)
                        toggle(row, !f.expanded)
                      }}
                    >
                      {f.expanded ? '▾' : '▸'}
                    </span>
                  ) : (
                    <span className="tree-twisty empty" />
                  )}

                  <span className="tree-label">
                    {row.keyword && <span className="tree-kw">{row.keyword}</span>}
                    {row.prefix && <span className="tree-prefix">{row.prefix}</span>}
                    <span className="tree-name">{row.label}</span>
                    {row.signature && <span className="tree-sig">{row.signature}</span>}
                  </span>

                  {link && (
                    <span className="tree-link" title={link === 'in' ? 'calls the selection' : 'used by the selection'}>
                      {link === 'in' ? '←' : link === 'out' ? '→' : '↔'}
                    </span>
                  )}
                  {row.delta && <span className="tree-delta">{row.delta}</span>}
                  {row.kind !== 'symbol' && row.changed > 0 && (
                    <span className="tree-count">{row.changed}</span>
                  )}
                  {CHANGE_MARK[row.own] && row.kind === 'symbol' && (
                    <span className="tree-chip">{CHANGE_MARK[row.own]}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
