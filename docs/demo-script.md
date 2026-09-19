# Demo script

1. Open https://github.com/astral-sh/uv/pull/21827 — four files, +561 −647, a wall of red and green.
2. Paste the URL into Change graph and press Enter. The structure tree shows the refactor: `Plan` gone, `Target` carrying the state.
3. Click `Target` to see new fields (`publish_args`, `environment`, `secrets`) and likely callers (`PublishTest`, `TargetSession`). Related rows in the tree pick up quiet arrows; the selected row shows caller/callee counts.
4. Use the review stepper or `j`/`k` to walk definitions before users. `[`/`]` is back/forward through what you have already opened.
5. Paste `https://github.com/astral-sh/uv/pull/12705` and press Enter. The pipeline still parses the workflow pin; Python symbols stay the tree's focus.
