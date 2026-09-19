import type { ChangeKind } from './types'

export const CHANGE_COLOR: Record<ChangeKind, string> = {
  added: '#16a34a',
  modified: '#2563eb',
  moved: '#7c3aed',
  removed: '#dc2626',
  'unchanged-affected': '#a16207',
  unchanged: '#a1a1aa',
}

/** Most interesting change first — containers take the strongest colour inside them. */
export const SEVERITY: ChangeKind[] = [
  'removed',
  'added',
  'modified',
  'moved',
  'unchanged-affected',
  'unchanged',
]

export const CORE_CHANGES = new Set<ChangeKind>(['added', 'removed', 'modified', 'moved'])

export function strongestChange(a: ChangeKind, b: ChangeKind): ChangeKind {
  return SEVERITY.indexOf(a) <= SEVERITY.indexOf(b) ? a : b
}
