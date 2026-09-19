# Change graph

A pull request is a graph of **symbols**, not a wall of file hunks. Nodes are classes, methods, and functions. Edges are containment and likely references.

## Run

```bash
npm install
npm run dev
```

Paste a GitHub pull request URL and press Enter. Calls are unauthenticated, so public repositories only, and they are subject to GitHub's anonymous rate limit.

Deep link: `http://localhost:5173/?pr=https://github.com/astral-sh/uv/pull/21827`

Live: `https://nikitaroz.github.io/change-graph/?pr=https://github.com/astral-sh/uv/pull/21827`

## The view

The main view is a symbol tree, grouped by file.

- Each node is colored by its own change (added, modified, moved, removed).
- The right pane shows the per-symbol diff, callers, callees, and any checks for the selected node.

Keyboard: `j`/`k` walks review order (definitions before users). `[`/`]` is back/forward.

## Scope

**Python only** right now. YAML jobs and steps are still parsed in the pipeline but are not drawn in the tree.

## Limits

Python resolution is **name-based** (same file, then same simple name). Reference edges are labeled likely. Matching across renames uses body similarity; confidence is shown on the symbol.

## Stack

Vite, React, TypeScript, `web-tree-sitter`, `tree-sitter-wasm`, `diff`.
