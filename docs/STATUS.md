# Status — where to resume

_Updated at the end of each module. Read this first if you are a new session._

| Module | State | Evidence |
|---|---|---|
| 0 Research | done | `docs/RESEARCH.md` |
| 1 Architecture | done | `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` |
| 1 Orbital Digital Twin | **done** | `raan/catalog`, `web/src/twin`; real snapshot 20,152 objects (2026-11-11 22:42 UTC); Vallado test: 666 vectors, max 1.2e-7 km |
| 2 Collision Research Lab | **done** | `raan/collision`, `web/src/pages/CollisionPage.tsx`, `web/public/data/collision.json` |
| 3 Manoeuvre Detection | **done** | `raan/maneuver`, `web/src/pages/ManeuverPage.tsx`, `web/public/data/maneuvers*.json` |
| 4 Orbital Intelligence | pending | — |
| 5 Research page + PDF | pending | — |
| LinkedIn content | pending | — |

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
* Forward archive for manoeuvres starts when `daily.yml` first runs on GitHub.
