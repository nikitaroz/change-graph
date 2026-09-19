export type ChangeKind =
  | 'added'
  | 'removed'
  | 'modified'
  | 'moved'
  | 'unchanged-affected'
  | 'unchanged'

export type SymbolKind =
  | 'module'
  | 'class'
  | 'function'
  | 'method'
  | 'yaml-job'
  | 'yaml-step'
  | 'yaml-key'

export type EdgeKind = 'contains' | 'references' | 'tests' | 'invokes'
export type EdgeConfidence = 'likely' | 'certain'

export type Span = {
  startLine: number
  startCol: number
  endLine: number
  endCol: number
}

export type SymbolNode = {
  id: string
  qname: string
  kind: SymbolKind
  file: string
  change: ChangeKind
  matchConfidence?: number
  spanBase?: Span
  spanHead?: Span
  bodyBase?: string
  bodyHead?: string
  signatureBase?: string
  signatureHead?: string
  language: 'python' | 'yaml' | 'other'
  note?: string
  parentQname?: string
}

export type GraphEdge = {
  from: string
  to: string
  kind: EdgeKind
  confidence: EdgeConfidence
}

export type CheckFinding = {
  type: 'dangling-ref' | 'signature-mismatch' | 'untested' | 'untouched-sibling'
  symbolId: string
  message: string
}

export type PullRequestInfo = {
  owner: string
  repo: string
  number: number
  title: string
  description?: string
  url: string
  baseSha: string
  headSha: string
  baseRef: string
  headRef: string
}

export type ChangedFile = {
  filename: string
  status: string
  additions: number
  deletions: number
  previousFilename?: string
  baseContent?: string
  headContent?: string
}

export type ChangeGraph = {
  pr: PullRequestInfo
  files: ChangedFile[]
  nodes: SymbolNode[]
  edges: GraphEdge[]
  checks: CheckFinding[]
  reviewOrder: string[]
}

export type ExtractedSymbol = {
  qname: string
  kind: SymbolKind
  file: string
  span: Span
  body: string
  signature: string
  language: 'python' | 'yaml' | 'other'
  parentQname?: string
  simpleName: string
}
