# Change graph

A pull request is a tree of **symbols**, not a wall of file hunks. Nodes are classes, methods, and functions. Edges are containment and likely references.

## Run

```bash
npm install
npm run dev
```

Paste a GitHub pull request URL and press Enter. Public repositories only — calls are unauthenticated and subject to GitHub's anonymous rate limit.

Deep link: `http://localhost:5173/?pr=https://github.com/astral-sh/uv/pull/21827`

Live: `https://nikitaroz.github.io/change-graph/?pr=https://github.com/astral-sh/uv/pull/21827`

## The view

The main view is a symbol tree, grouped by file, in source order.

- Rows read like the code they came from: `class Target:` and `def publish(…)`.
- Added, modified, moved, and removed symbols use their own color, mark, and gutter.
- Click a symbol to inspect it. Folders and files expand from the chevron so a class click does not collapse its methods.
- Selecting a symbol highlights its ancestor path and likely callers/callees.

The right pane shows the per-symbol diff, callers, callees, and any checks for the selected node.

Keyboard: `j`/`k` walks review order (definitions before users). Arrow keys move in the tree. `[`/`]` is back/forward.

## Scope

**Python only** right now. YAML jobs and steps are still parsed in the pipeline but are not drawn in the tree.

## Limits

Python resolution is **name-based** (same file, then same simple name). Reference edges are labeled likely. Matching across renames uses body similarity; a note is shown on the symbol when the match is a rename, move, or formatting-only change.

## Stack

Vite, React, TypeScript, `web-tree-sitter`, `tree-sitter-wasm`, `diff`.
