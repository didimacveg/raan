# Status — where to resume

_Updated at the end of each module. Read this first if you are a new session._

| Module | State | Evidence |
|---|---|---|
| 0 Research | done | `docs/RESEARCH.md` |
| 1 Architecture | done | `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` |
| 1 Orbital Digital Twin | **done** | `raan/catalog`, `web/src/twin`; real snapshot 20,152 objects (2026-11-11 22:42 UTC); Vallado test: 666 vectors, max 1.2e-7 km |
| 2 Collision Research Lab | **done** | `raan/collision`, `web/src/pages/CollisionPage.tsx`, `web/public/data/collision.json` |
| 3 Manoeuvre Detection | **done** | `raan/maneuver`, `web/src/pages/ManeuverPage.tsx`, `web/public/data/maneuvers*.json` |
| 4 Orbital Intelligence | **done** (Claude path untested: no key) | `raan/intel`, `reports/latest.md`, `web/public/data/report.json` |
| 5 Research page + PDF | **done** | `web/src/pages/ResearchPage.tsx`, `reports/RAAN_technical_report.pdf` (6 pages) |
| LinkedIn content | **done** | `content/CALENDARIO.md`, 13 images, 4 videos; generator `web/scripts/content.cjs` |
| Deploy | **waiting for Diego** | `docs/PASOS_PARA_DIEGO.md` steps 1–3 |

## Pre-launch review (independent session, 2026-11-12) — progress log

Work is on branch `claude/raan-pre-launch-review-8qqz4h` (based on `claude/epic-volta-jjkxwt`).
Updated after every step so a new session can resume.

| Step | State | What was actually checked |
|---|---|---|
| 1 Security | **done** | Full git history scanned for keys/tokens/paths: none. Found and fixed: absolute local paths published inside `catalog.json` (`meta.fetch[].path`). Workflows rewritten with per-job least privilege and SHA-pinned actions. |
| 2 Licences | **done** | Zenodo API: CC BY 4.0, md5 matches. Space-Track documentation: blanket redistribution approval for TLE/OMM/SATCAT with citation (read today). CelesTrak usage policy read today: no licence text, no redistribution clause. Manoeuvre benchmark: still no licence at the pinned commit (= upstream HEAD); label timestamps were being republished → now only the bracketing element-set interval is published. |
| 3 Code review | in progress | L = 0.694 recomputed independently from the raw CSVs; full collision run reproduces every published figure; manoeuvre run reproduces F1 0.79/0.73/0.51; independent recount from timelines matches. Fixes so far: fetcher stops on first HTTP error, build refuses incomplete inputs, caveats kept when an LLM rewrites, LEO-only orbit-change finding, nested CV added, chance level added. |
| 4 Traceability | pending | |
| 5 Performance | pending | |
| 6 Deploy | workflow rewritten; local simulation pending | |
| 7 `docs/DEFENSA.md` | pending | |
| 8 Posts | pending | |

## How to run

```bash
make setup            # venv + npm
make data             # ESA CDM dataset (221 MB) + TLE benchmark
make reproduce        # collision + manoeuvres + report + web build
make catalog          # live CelesTrak snapshot (max once per 2 h!)
cd web && npm run dev # http://localhost:5173
make test
```

## Known gaps / next steps

* Frame rate was only measured under headless software rendering (8 fps with 20 k objects in
  SwiftShader). It must be measured on a real GPU: open `/?stress=30000&fps=1`.
* The Space-Track path (full ~35 k catalogue) is not implemented beyond documentation.
* `pages.yml` (deploy + daily archive) has never run: it cannot until the branch is merged to
  `main` and Pages is enabled. First run needs watching.
* The live "orbit changes since the previous snapshot" finding has only been exercised with
  synthetic snapshot pairs (and one real partial pair); it needs two real daily snapshots.
* The Claude editor path is covered by tests with fake writers only.
* Not reviewed line-by-line by a human yet.
* Forward archive for manoeuvres starts when `daily.yml` first runs on GitHub.
