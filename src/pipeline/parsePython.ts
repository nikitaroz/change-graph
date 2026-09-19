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

function signatureOf(source: string, node: Node): string {
  // The first ":" in source order is often a parameter annotation (`x: int`), not
  // the end of the def/class header. The syntactic body starts after the header.
  const body = node.childForFieldName('body')
  const end = body ? body.startIndex : node.endIndex
  const raw = source.slice(node.startIndex, end).replace(/\s+/g, ' ').trim()
  if (raw) return raw
  const firstNl = source.indexOf('\n', node.startIndex)
  return source.slice(node.startIndex, firstNl === -1 ? node.endIndex : firstNl).trim()
}

export function extractPython(
  source: string,
  tree: Tree,
  file: string,
): ExtractedSymbol[] {
  const out: ExtractedSymbol[] = []
  const moduleQname = file.replace(/\.py$/, '').split('/').pop() ?? file
  out.push({
    qname: moduleQname,
    kind: 'module',
    file,
    span: spanOf(tree.rootNode),
    body: source,
    signature: file,
    language: 'python',
    simpleName: moduleQname,
  })

  function walk(node: Node, classStack: string[], parent?: string) {
    if (node.type === 'class_definition' || node.type === 'function_definition') {
      const name = node.childForFieldName('name')?.text
      if (!name) return
      const qname = [...classStack, name].join('.')
      const kind: SymbolKind =
        node.type === 'class_definition'
          ? 'class'
          : classStack.length
            ? 'method'
            : 'function'
      out.push({
        qname,
        kind,
        file,
        span: spanOf(node),
        body: source.slice(node.startIndex, node.endIndex),
        signature: signatureOf(source, node),
        language: 'python',
        parentQname: parent,
        simpleName: name,
      })
      const nextStack = [...classStack, name]
      const body = node.childForFieldName('body')
      if (body) {
        for (const child of body.namedChildren) walk(child, nextStack, qname)
      }
      return
    }
    for (const child of node.namedChildren) walk(child, classStack, parent)
  }

  walk(tree.rootNode, [], moduleQname)
  return out
}

export function pythonEnclosingQname(node: Node): string | undefined {
  let cur: Node | null = node
  const stack: string[] = []
  while (cur) {
    if (cur.type === 'function_definition' || cur.type === 'class_definition') {
      const name = cur.childForFieldName('name')?.text
      if (name) stack.push(name)
    }
    cur = cur.parent
  }
  stack.reverse()
  return stack.length ? stack.join('.') : undefined
}

export function collectPythonImports(root: Node): Map<string, string> {
  const aliases = new Map<string, string>()
  function walk(node: Node) {
    if (node.type === 'import_from_statement' || node.type === 'import_statement') {
      const text = node.text
      const fromMatch = text.match(/from\s+([\w.]+)\s+import\s+(.+)/)
      if (fromMatch) {
        const names = fromMatch[2].split(',')
        for (const raw of names) {
          const asMatch = raw.trim().match(/^(\w+)(?:\s+as\s+(\w+))?/)
          if (asMatch) aliases.set(asMatch[2] ?? asMatch[1], `${fromMatch[1]}.${asMatch[1]}`)
        }
      }
    }
    for (const child of node.namedChildren) walk(child)
  }
  walk(root)
  return aliases
}
