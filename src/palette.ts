import type { ChangeKind } from './types'

export const CHANGE_COLOR: Record<ChangeKind, string> = {
  added: '#3dd68c',
  modified: '#6cb6ff',
  moved: '#c9a0ff',
  removed: '#ff6b6b',
  'unchanged-affected': '#d9c48a',
  unchanged: '#5d6676',
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
