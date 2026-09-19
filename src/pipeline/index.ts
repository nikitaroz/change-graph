import type { ChangeGraph, ChangedFile, ExtractedSymbol, PullRequestInfo, SymbolNode } from '../types'
import { runChecks } from './checks'
import { linkPython, linkYaml } from './link'
import { matchSymbols } from './match'
import { markAffected, reviewOrder } from './order'
import { extractPython } from './parsePython'
import { extractYaml } from './parseYaml'
import { parseSource } from './treesitter'
import type { Tree } from 'web-tree-sitter'

/**
 * A GitHub rename keeps the same path on both extracted sides, so exact-body
 * symbols would otherwise look unchanged and vanish from the "changed only" tree.
 */
function markRenamedFiles(nodes: SymbolNode[], files: ChangedFile[]) {
  const fromByPath = new Map(
    files
      .filter((f) => f.previousFilename && f.previousFilename !== f.filename)
      .map((f) => [f.filename, f.previousFilename!]),
  )
  if (fromByPath.size === 0) return
  for (const node of nodes) {
    const previous = fromByPath.get(node.file)
    if (!previous) continue
    if (node.change === 'unchanged') {
      node.change = 'moved'
      node.note = node.note ?? `moved from ${previous}`
    } else if (!node.note && node.change === 'modified') {
      node.note = `also renamed from ${previous}`
    }
  }
}

function langOf(filename: string): 'python' | 'yaml' | 'other' {
  if (filename.endsWith('.py')) return 'python'
  if (/\.ya?ml$/i.test(filename)) return 'yaml'
  return 'other'
}

async function extractFile(
  filename: string,
  content: string | undefined,
): Promise<{ symbols: ExtractedSymbol[]; tree?: Tree; source?: string }> {
  if (!content) return { symbols: [] }
  const lang = langOf(filename)
  if (lang === 'other') return { symbols: [] }
  const tree = await parseSource(lang, content)
  const symbols = lang === 'python' ? extractPython(content, tree, filename) : extractYaml(content, tree, filename)
  return { symbols, tree, source: content }
}

export async function buildChangeGraph(
  pr: PullRequestInfo,
  files: ChangedFile[],
): Promise<ChangeGraph> {
  const baseSymbols: ExtractedSymbol[] = []
  const headSymbols: ExtractedSymbol[] = []
  const headTrees = new Map<string, { source: string; tree: Tree }>()

  for (const file of files) {
    const [baseEx, headEx] = await Promise.all([
      extractFile(file.filename, file.baseContent),
      extractFile(file.filename, file.headContent),
    ])
    baseSymbols.push(...baseEx.symbols)
    headSymbols.push(...headEx.symbols)
    if (headEx.tree && headEx.source) {
      headTrees.set(file.filename, { source: headEx.source, tree: headEx.tree })
    }
  }

  const nodes = matchSymbols(baseSymbols, headSymbols)
  markRenamedFiles(nodes, files)
  const edges = [
    ...(await linkPython(nodes, headTrees)),
    ...linkYaml(nodes),
  ]
  markAffected(nodes, edges)
  const checks = runChecks(nodes, edges)
  const order = reviewOrder(nodes, edges)

  return { pr, files, nodes, edges, checks, reviewOrder: order }
}
