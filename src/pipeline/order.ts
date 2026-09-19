import type { GraphEdge, SymbolNode } from '../types'

const REVIEWABLE = new Set(['added', 'removed', 'modified', 'moved', 'unchanged-affected'])

export function reviewOrder(nodes: SymbolNode[], edges: GraphEdge[]): string[] {
  const changed = nodes.filter((n) => REVIEWABLE.has(n.change) && n.kind !== 'module')
  const ids = new Set(changed.map((n) => n.id))
  const adj = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const n of changed) {
    adj.set(n.id, [])
    indeg.set(n.id, 0)
  }
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue
    // definitions before users: edge from user -> def becomes def first
    if (e.kind === 'references' || e.kind === 'tests' || e.kind === 'invokes') {
      adj.get(e.to)?.push(e.from)
      indeg.set(e.from, (indeg.get(e.from) ?? 0) + 1)
    } else if (e.kind === 'contains') {
      adj.get(e.from)?.push(e.to)
      indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
    }
  }

  const byFile = new Map<string, SymbolNode[]>()
  for (const n of changed) {
    const list = byFile.get(n.file) ?? []
    list.push(n)
    byFile.set(n.file, list)
  }

  const result: string[] = []
  const seen = new Set<string>()

  const files = [...byFile.keys()].sort((a, b) => {
    const ca = byFile.get(a)!.length
    const cb = byFile.get(b)!.length
    if (cb !== ca) return cb - ca
    return a.localeCompare(b)
  })
  for (const file of files) {
    const group = byFile.get(file)!
    const queue = group
      .filter((n) => (indeg.get(n.id) ?? 0) === 0)
      .sort((a, b) => (a.spanHead?.startLine ?? a.spanBase?.startLine ?? 0) - (b.spanHead?.startLine ?? b.spanBase?.startLine ?? 0))
    while (queue.length) {
      const n = queue.shift()!
      if (seen.has(n.id)) continue
      seen.add(n.id)
      result.push(n.id)
      for (const nxt of adj.get(n.id) ?? []) {
        indeg.set(nxt, (indeg.get(nxt) ?? 1) - 1)
        if ((indeg.get(nxt) ?? 0) <= 0) {
          const node = group.find((g) => g.id === nxt)
          if (node) queue.push(node)
        }
      }
    }
    for (const n of group) {
      if (!seen.has(n.id)) {
        seen.add(n.id)
        result.push(n.id)
      }
    }
  }
  return result
}

export function markAffected(nodes: SymbolNode[], edges: GraphEdge[]): void {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const changed = new Set(nodes.filter((n) => n.change !== 'unchanged').map((n) => n.id))
  for (const e of edges) {
    if (!changed.has(e.to) && !changed.has(e.from)) continue
    const neighbor = changed.has(e.to) ? byId.get(e.from) : byId.get(e.to)
    if (neighbor && neighbor.change === 'unchanged') neighbor.change = 'unchanged-affected'
  }
}
