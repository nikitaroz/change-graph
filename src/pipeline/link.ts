import { Query } from 'web-tree-sitter'
import type { GraphEdge, SymbolNode } from '../types'
import { pythonEnclosingQname } from './parsePython'
import { PYTHON_TAGS, languages } from './treesitter'
import type { Tree } from 'web-tree-sitter'

function simple(qname: string) {
  return qname.split('.').pop() ?? qname
}

/**
 * References are read out of the head tree, so they point at whatever survives in
 * head. Only fall back to a removed symbol when nothing live carries the name —
 * that fallback is what surfaces a dangling reference.
 */
function preferLive(candidates: SymbolNode[]): SymbolNode[] {
  const live = candidates.filter((n) => n.change !== 'removed')
  return live.length ? live : candidates
}

function findByName(nodes: SymbolNode[], name: string, file?: string): SymbolNode[] {
  const named = nodes.filter((n) => simple(n.qname) === name && n.kind !== 'module')
  const sameFile = named.filter((n) => n.file === file)
  return preferLive(sameFile.length ? sameFile : named)
}

export async function linkPython(
  nodes: SymbolNode[],
  headTrees: Map<string, { source: string; tree: Tree }>,
): Promise<GraphEdge[]> {
  const edges: GraphEdge[] = []
  const seen = new Set<string>()
  const push = (from: string, to: string, kind: GraphEdge['kind']) => {
    const key = `${from}->${to}:${kind}`
    if (seen.has(key) || from === to) return
    seen.add(key)
    edges.push({ from, to, kind, confidence: 'likely' })
  }

  for (const node of nodes) {
    const parent = nodes.find(
      (n) =>
        n.file === node.file &&
        n.qname !== node.qname &&
        node.qname.startsWith(`${n.qname}.`) &&
        node.qname.slice(n.qname.length + 1).indexOf('.') === -1,
    )
    if (parent) push(parent.id, node.id, 'contains')
  }

  const langs = await languages()
  let query: Query | null
  try {
    query = new Query(langs.python, PYTHON_TAGS)
  } catch {
    query = null
  }

  for (const [file, { tree }] of headTrees) {
    const fileNodes = nodes.filter((n) => n.file === file)
    const captures = query
      ? query.captures(tree.rootNode)
      : []
    for (const cap of captures) {
      if (!cap.name.includes('reference')) continue
      const name = cap.node.text
      const fromQ = pythonEnclosingQname(cap.node)
      const from = fileNodes.find((n) => n.qname === fromQ) ?? fileNodes.find((n) => n.kind === 'module')
      if (!from) continue
      const targets = findByName(nodes, name, file)
      for (const to of targets) {
        const testLike =
          /test/i.test(from.file) || /^test_/i.test(simple(from.qname)) || from.qname.includes('Test')
        push(from.id, to.id, testLike ? 'tests' : 'references')
      }
    }

    if (!query) {
      const walk = (node: typeof tree.rootNode) => {
        if (node.type === 'call') {
          const fn = node.childForFieldName('function')
          const nameNode =
            fn?.type === 'identifier' ? fn : fn?.childForFieldName('attribute') ?? fn?.namedChildren.at(-1)
          const name = nameNode?.text
          if (name) {
            const fromQ = pythonEnclosingQname(node)
            const from = fileNodes.find((n) => n.qname === fromQ) ?? fileNodes.find((n) => n.kind === 'module')
            if (from) {
              for (const to of findByName(nodes, name, file)) {
                const testLike =
                  /test/i.test(from.file) ||
                  /^test_/i.test(simple(from.qname)) ||
                  from.qname.includes('Test')
                push(from.id, to.id, testLike ? 'tests' : 'references')
              }
            }
          }
        }
        for (const child of node.namedChildren) walk(child)
      }
      walk(tree.rootNode)
    }
  }

  return edges
}

export function linkYaml(nodes: SymbolNode[]): GraphEdge[] {
  const edges: GraphEdge[] = []
  const seen = new Set<string>()
  const push = (from: string, to: string, kind: GraphEdge['kind']) => {
    const key = `${from}->${to}:${kind}`
    if (seen.has(key) || from === to) return
    seen.add(key)
    edges.push({ from, to, kind, confidence: 'certain' })
  }
  for (const node of nodes) {
    const parent = nodes.find(
      (n) =>
        n.file === node.file &&
        n.qname !== node.qname &&
        (node.qname.startsWith(`${n.qname}.`) || node.qname.startsWith(`${n.qname}[`)) &&
        n.qname.split('.').length === node.qname.split('.').length - 1,
    )
    if (parent) {
      push(parent.id, node.id, 'contains')
    }
    if (node.kind === 'yaml-key' && node.qname.endsWith('.uses') && (node.bodyHead ?? node.bodyBase)?.includes('maturin')) {
      const step = nodes.find((n) => n.kind === 'yaml-step' && node.qname.startsWith(n.qname))
      if (step) push(step.id, node.id, 'invokes')
    }
  }
  return edges
}
