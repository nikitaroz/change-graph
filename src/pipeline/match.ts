import type { ChangeKind, ExtractedSymbol, SymbolNode } from '../types'
import { hashText, jaccard, nameAffinity, normalizeWhitespace, tokenSet } from './hash'

type Side = ExtractedSymbol & { raw: string; norm: string }

function toSide(s: ExtractedSymbol): Side {
  return { ...s, raw: hashText(s.body), norm: hashText(normalizeWhitespace(s.body)) }
}

function compatible(a: Side, b: Side): boolean {
  if (a.language !== b.language) return false
  if (a.kind === b.kind) return true
  const fn = new Set(['function', 'method'])
  return fn.has(a.kind) && fn.has(b.kind)
}

function score(a: Side, b: Side): number {
  if (a.raw === b.raw) return 1
  if (a.norm === b.norm) return 0.95
  const body = jaccard(tokenSet(a.body), tokenSet(b.body))
  const names = nameAffinity(a.qname, b.qname)
  return body * 0.65 + names * 0.35
}

export function matchSymbols(
  base: ExtractedSymbol[],
  head: ExtractedSymbol[],
): SymbolNode[] {
  const baseSides = base.map(toSide)
  const headSides = head.map(toSide)
  const usedBase = new Set<number>()
  const usedHead = new Set<number>()
  const nodes: SymbolNode[] = []

  function emit(b: Side | undefined, h: Side | undefined, change: ChangeKind, conf: number, note?: string) {
    const sample = (h ?? b)!
    nodes.push({
      id: `${sample.file}::${h?.qname ?? b?.qname}::${b?.span.startLine ?? 0}-${h?.span.startLine ?? 0}`,
      qname: h?.qname ?? b!.qname,
      kind: h?.kind ?? b!.kind,
      file: h?.file ?? b!.file,
      change,
      matchConfidence: conf,
      spanBase: b?.span,
      spanHead: h?.span,
      bodyBase: b?.body,
      bodyHead: h?.body,
      signatureBase: b?.signature,
      signatureHead: h?.signature,
      language: sample.language,
      note,
      parentQname: h?.parentQname ?? b?.parentQname,
    })
  }

  const baseByKey = new Map<string, number[]>()
  baseSides.forEach((s, i) => {
    const key = `${s.file}::${s.qname}`
    const list = baseByKey.get(key) ?? []
    list.push(i)
    baseByKey.set(key, list)
  })

  headSides.forEach((h, hi) => {
    const key = `${h.file}::${h.qname}`
    const candidates = baseByKey.get(key) ?? []
    const bi = candidates.find((i) => !usedBase.has(i))
    if (bi === undefined) return
    usedBase.add(bi)
    usedHead.add(hi)
    const b = baseSides[bi]
    if (b.raw === h.raw) emit(b, h, 'unchanged', 1)
    else if (b.norm === h.norm) emit(b, h, 'unchanged', 0.99, 'formatting-only')
    else emit(b, h, 'modified', 1)
  })

  const leftoverBase = baseSides.map((s, i) => [s, i] as const).filter(([, i]) => !usedBase.has(i))
  const leftoverHead = headSides.map((s, i) => [s, i] as const).filter(([, i]) => !usedHead.has(i))

  const pairs: { bi: number; hi: number; sc: number }[] = []
  for (const [b, bi] of leftoverBase) {
    if (b.kind === 'module') continue
    for (const [h, hi] of leftoverHead) {
      if (!compatible(b, h)) continue
      const sc = score(b, h)
      if (sc >= 0.32) pairs.push({ bi, hi, sc })
    }
  }
  pairs.sort((a, b) => b.sc - a.sc)
  for (const { bi, hi, sc } of pairs) {
    if (usedBase.has(bi) || usedHead.has(hi)) continue
    usedBase.add(bi)
    usedHead.add(hi)
    const b = baseSides[bi]
    const h = headSides[hi]
    if (b.norm === h.norm) {
      // Same body up to whitespace: either it relocated, or the exact-key pass
      // lost it to a same-named sibling and only the formatting differs.
      if (b.qname !== h.qname || b.file !== h.file) {
        emit(b, h, 'moved', sc, `moved from ${b.qname}`)
      } else {
        emit(b, h, 'unchanged', 0.99, 'formatting-only')
      }
    } else {
      const note =
        b.qname !== h.qname
          ? `renamed from ${b.qname}`
          : b.file !== h.file
            ? `moved from ${b.file}`
            : undefined
      emit(b, h, 'modified', sc, note)
    }
  }

  leftoverBase.forEach(([b, i]) => {
    if (!usedBase.has(i)) emit(b, undefined, 'removed', 1)
  })
  leftoverHead.forEach(([h, i]) => {
    if (!usedHead.has(i)) emit(undefined, h, 'added', 1)
  })

  const seen = new Set<string>()
  for (const n of nodes) {
    let id = n.id
    for (let dup = 2; seen.has(id); dup++) id = `${n.id}#${dup}`
    seen.add(id)
    n.id = id
  }
  return nodes
}
