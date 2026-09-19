import type { ExtractedSymbol, Span, SymbolKind } from '../types'
import type { Node, Tree } from 'web-tree-sitter'

function spanOf(node: Node): Span {
  return {
    startLine: node.startPosition.row + 1,
    startCol: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endCol: node.endPosition.column + 1,
  }
}

function keyText(node: Node): string {
  return node.text.replace(/^['"]|['"]$/g, '').trim()
}

function mappingPairs(node: Node): { key: string; value: Node; pair: Node }[] {
  const mapping =
    node.type === 'block_mapping' || node.type === 'flow_mapping'
      ? node
      : node.namedChildren.find(
          (c) => c.type === 'block_mapping' || c.type === 'flow_mapping',
        )
  if (!mapping) return []
  const pairs: { key: string; value: Node; pair: Node }[] = []
  for (const child of mapping.namedChildren) {
    if (child.type !== 'block_mapping_pair' && child.type !== 'flow_pair') continue
    const keyNode = child.childForFieldName('key')
    const valueNode = child.childForFieldName('value')
    if (!keyNode || !valueNode) continue
    pairs.push({ key: keyText(keyNode), value: valueNode, pair: child })
  }
  return pairs
}

function sequenceItems(node: Node): Node[] {
  const seq =
    node.type === 'block_sequence' || node.type === 'flow_sequence'
      ? node
      : node.namedChildren.find(
          (c) => c.type === 'block_sequence' || c.type === 'flow_sequence',
        )
  if (!seq) return []
  return seq.namedChildren.filter(
    (c) => c.type === 'block_sequence_item' || c.type === 'flow_node',
  )
}

function unwrapItem(item: Node): Node {
  if (item.type === 'block_sequence_item') {
    return item.namedChildren[0] ?? item
  }
  return item
}

function lookup(node: Node, key: string): Node | undefined {
  const direct = mappingPairs(node).find((p) => p.key === key)?.value
  if (direct) return direct
  for (const child of node.namedChildren) {
    const found = lookup(child, key)
    if (found) return found
  }
  return undefined
}

function push(
  out: ExtractedSymbol[],
  file: string,
  qname: string,
  kind: SymbolKind,
  node: Node,
  parent?: string,
) {
  const simpleName = qname.split('.').pop() ?? qname
  out.push({
    qname,
    kind,
    file,
    span: spanOf(node),
    body: node.text,
    signature: qname,
    language: 'yaml',
    parentQname: parent,
    simpleName,
  })
}

function walkKeys(
  out: ExtractedSymbol[],
  file: string,
  prefix: string,
  node: Node,
  parent: string,
) {
  for (const { key, value, pair } of mappingPairs(node)) {
    const qname = `${prefix}.${key}`
    push(out, file, qname, 'yaml-key', pair, parent)
    if (mappingPairs(value).length) walkKeys(out, file, qname, value, qname)
  }
}

export function extractYaml(source: string, tree: Tree, file: string): ExtractedSymbol[] {
  const out: ExtractedSymbol[] = []
  const moduleQname = file.split('/').pop() ?? file
  out.push({
    qname: moduleQname,
    kind: 'module',
    file,
    span: spanOf(tree.rootNode),
    body: source,
    signature: file,
    language: 'yaml',
    simpleName: moduleQname,
  })

  const jobsNode = lookup(tree.rootNode, 'jobs')
  if (!jobsNode) {
    walkKeys(out, file, moduleQname, tree.rootNode, moduleQname)
    return out
  }

  for (const job of mappingPairs(jobsNode)) {
    const jobQ = `jobs.${job.key}`
    push(out, file, jobQ, 'yaml-job', job.pair, moduleQname)
    const stepsNode = lookup(job.value, 'steps')
    if (!stepsNode) continue
    const items = sequenceItems(stepsNode)
    items.forEach((item, index) => {
      const stepNode = unwrapItem(item)
      const pairs = mappingPairs(stepNode)
      const name =
        pairs.find((p) => p.key === 'name')?.value.text.replace(/^['"]|['"]$/g, '').trim() ??
        pairs.find((p) => p.key === 'id')?.value.text.trim() ??
        pairs.find((p) => p.key === 'uses')?.value.text.split('@')[0].split('/').pop() ??
        String(index)
      const stepQ = `jobs.${job.key}.steps[${name}]`
      push(out, file, stepQ, 'yaml-step', item, jobQ)
      walkKeys(out, file, stepQ, stepNode, stepQ)
    })
  }
  return out
}
