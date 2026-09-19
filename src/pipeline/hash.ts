export function hashText(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function tokenSet(text: string): Set<string> {
  return new Set(text.split(/[^A-Za-z0-9_]+/).filter((t) => t.length > 1))
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

export function nameAffinity(a: string, b: string): number {
  if (a === b) return 1
  const strip = (s: string) => (s.split('.').pop() ?? s).replace(/^_/, '')
  const as = strip(a)
  const bs = strip(b)
  if (as === bs) return 0.9
  if (as.startsWith(bs) || bs.startsWith(as)) {
    const shorter = Math.min(as.length, bs.length)
    if (shorter >= 4) return 0.55
  }
  if (as.includes(bs) || bs.includes(as)) {
    const shorter = Math.min(as.length, bs.length)
    if (shorter >= 6) return 0.4
  }
  return 0
}
