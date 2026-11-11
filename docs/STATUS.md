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
