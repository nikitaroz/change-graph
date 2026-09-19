import type { CheckFinding, GraphEdge, SymbolNode } from '../types'

const CHANGED = new Set(['added', 'removed', 'modified', 'moved'])
const USES = new Set<GraphEdge['kind']>(['references', 'tests', 'invokes'])

export function runChecks(nodes: SymbolNode[], edges: GraphEdge[]): CheckFinding[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const findings: CheckFinding[] = []

  for (const node of nodes) {
    if (node.change === 'removed') {
      const remaining = edges.filter(
        (e) => e.to === node.id && USES.has(e.kind) && byId.get(e.from)?.change !== 'removed',
      )
      findings.push({
        type: 'dangling-ref',
        symbolId: node.id,
        message: `${node.qname}: ${remaining.length} reference${remaining.length === 1 ? '' : 's'} remain`,
      })
    }

    if (node.change === 'modified' && node.signatureBase && node.signatureHead && node.signatureBase !== node.signatureHead) {
      const callers = edges.filter((e) => e.to === node.id && (e.kind === 'references' || e.kind === 'tests'))
      const stale = callers.filter((e) => {
        const from = byId.get(e.from)
        return from && from.change === 'unchanged'
      })
      if (stale.length) {
        findings.push({
          type: 'signature-mismatch',
          symbolId: node.id,
          message: `${node.qname}: signature changed; ${stale.length} caller(s) look unchanged`,
        })
      }
    }

    if (CHANGED.has(node.change) && (node.kind === 'function' || node.kind === 'method' || node.kind === 'class')) {
      const tests = edges.filter((e) => e.kind === 'tests' && e.to === node.id)
      if (tests.length === 0 && !/test/i.test(node.file) && !/test/i.test(node.qname)) {
        findings.push({
          type: 'untested',
          symbolId: node.id,
          message: `${node.qname}: no test references this changed symbol`,
        })
      }
    }
  }

  const steps = nodes.filter((n) => n.kind === 'yaml-step')
  const groups = new Map<string, SymbolNode[]>()
  for (const step of steps) {
    const uses = nodes.find((n) => n.qname === `${step.qname}.uses`)
    const action = (uses?.bodyHead ?? uses?.bodyBase ?? '').split('@')[0]
    if (!action) continue
    const job = step.qname.split('.steps[')[0]
    const key = `${job}::${action}`
    const list = groups.get(key) ?? []
    list.push(step)
    groups.set(key, list)
  }
  for (const [, group] of groups) {
    const changed = group.filter((s) => CHANGED.has(s.change))
    const untouched = group.filter((s) => s.change === 'unchanged')
    if (changed.length && untouched.length) {
      for (const s of untouched) {
        findings.push({
          type: 'untouched-sibling',
          symbolId: s.id,
          message: `${s.qname}: sibling step using the same action changed; this one did not`,
        })
      }
    }
  }

  return findings
}
