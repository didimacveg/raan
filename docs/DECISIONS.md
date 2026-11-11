# Decision log

Decisions taken autonomously while Diego was away. Newest last. "Why" is always the goal in the
brief: make a GMV/ESA/TU Delft engineer think *this student understands the problem*.

| # | Decision | Why | How to undo |
|---|---|---|---|
| 1 | Product renamed **KESSLER → RAAN** (repo name unchanged). | `kessler` is an existing ESA-linked ML library on the same topic, plus a start-up and a CubeSat (RESEARCH §5). The brief said: if it clashes, pick the best alternative. | Change `web/src/brand.ts`, `raan/brand.py`, then search/replace "RAAN" in `content/` and `README.md`. |
| 2 | OMM CSV only, no TLE parsing for live data. | 5-digit catalogue numbers ran out on 2026-07-11. | — |
| 3 | The globe shows only what CelesTrak serves in bulk (active + analyst + 3 debris clouds), with the true coverage ratio on screen. A `?stress=30000` mode adds labelled synthetic copies to test performance. | "Every number comes from a reproducible algorithm" beats "30,000 dots". | Add Space-Track credentials (PASOS §6) to get the full catalogue. |
| 4 | GitHub Pages instead of Vercel. | Zero extra accounts; cron and hosting in one place. | `web/dist` is host-agnostic. |
| 5 | `gl.POINTS` instead of instanced meshes. | Same visual, quarter of the vertices. | — |
| 6 | Manoeuvre benchmark is cloned at a pinned commit at build time, never vendored; only derived series are published. | The upstream repo has no licence file. | — |
| 7 | The created cloud environment `kessler` allows only: celestrak.org, zenodo.org, arxiv.org, kelvins.esa.int, www.space-track.org, github.com (+raw/codeload), ids-doris.org, repository.tudelft.nl. | Needed to download real data; smallest set. | Delete the environment in Claude settings. |
| 8 | CelesTrak `active` is downloaded at most once per 2-hour update, and never retried on HTTP errors. | Their usage policy; they firewall offenders. | — |
