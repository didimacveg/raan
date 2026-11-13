# Architecture

**One sentence:** a deterministic Python pipeline turns public data into small JSON artefacts; a
static WebGL site renders them; GitHub Actions re-runs the cheap part every day. No server, no
database, no paid service.

```
            ┌────────────────────────── GitHub Actions (cron, free) ──────────────────────────┐
 CelesTrak ─┤ raan.catalog   fetch OMM CSV + SATCAT → catalog.json  (+ daily archive branch)  │
            │ raan.intel     facts → agents → report.json / report.md                          │
            └───────────────────────────────┬──────────────────────────────────────────────────┘
 ESA CDMs (Zenodo, CC BY 4.0) ─ raan.collision ─┐           │  (run locally: `make reproduce`,
 TLE benchmark (IDS labels)   ─ raan.maneuver  ─┼─► web/public/data/*.json  minutes–1 h, committed)
                                 raan.report  ──┘           │
                                                            ▼
                         web/ (Vite + React + three.js)  →  static build  →  GitHub Pages
                         SGP4 in a Web Worker · one gl.POINTS draw call · hash routing
```

## Decisions

### Hosting: GitHub Pages (not Vercel)

| | GitHub Pages | Vercel (Hobby) |
|---|---|---|
| Cost | free for public repos | free, but Hobby is non-commercial only |
| Extra account / secrets | none — same place as the cron jobs | new account + token or Git integration |
| Deploy from the data cron | native (`actions/deploy-pages`) | needs a deploy hook |
| Risk for a later company pilot | none | licence change needed |

The build uses `base: './'` and hash routing, so the same `web/dist` also works on Vercel, Netlify
or any file server if Diego changes his mind. Pages needs the repository to be **public**.

### Front-end: three.js, hand-written shaders

* **Why three.js** and not CesiumJS/deck.gl/globe.gl: Cesium is ~4 MB and built around Earth-fixed
  terrain; its entity pipeline struggles above ~10 k dynamic objects without dropping to
  primitives anyway. deck.gl is map-first. globe.gl hides the render loop needed for key-frame
  interpolation. three.js gives direct control of buffers and shaders for ~170 kB gzipped.
* **One `gl.POINTS` draw call instead of instanced meshes.** The brief asks for instanced
  rendering; for dots that are 2–6 px on screen a point sprite *is* the instance, with one vertex
  instead of four and no index buffer. 30 k objects = 30 k vertices, one draw call.
* **SGP4 in a Web Worker, key-frame interpolation on the GPU.** A full-catalogue SGP4 pass takes
  tens of ms in JavaScript, too slow to do every frame on the main thread. The worker produces
  key-frames (two position buffers, `posA`, `posB`); the vertex shader interpolates direction
  and radius separately so objects follow their arc instead of cutting the chord. Key-frame
  spacing is capped at 240 s of simulated time (≤ 16° of arc in LEO). Rendering cost is therefore
  independent of propagation cost.
* **Adaptive quality.** The engine picks a starting tier from the device (software renderer,
  phone) and steps down while the frame rate stays under 24 fps: resolution first, and only if
  that is not enough it draws one object in two or three and says so on screen. `?lite=0`
  disables it. Measured with `web/scripts/perf.cjs` (software rendering, 20,152 objects):
  14 → 33 fps at 1366×768, 6 → 28 fps on a 2× display, 13 → 54 fps on a phone viewport.
* **Propagator:** `satellite.js` 7 (a port of Vallado's SGP4, WGS-72) initialised from **OMM**
  fields (`json2satrec`), because TLE cannot carry catalogue numbers > 99999. Verified against
  Vallado's `tcppver.out`: 666 state vectors, max |Δr| = 1.2e-7 km through the TLE reader and
  3.5e-5 km through `json2satrec` (`web/src/twin/sgp4.test.ts`, stored in `verification.json`).
* **Earth:** drawn at runtime from Natural Earth land polygons (public domain) into a canvas
  texture — no imagery licences, 100 kB instead of megabytes, and it matches the white lab look.
* **Frames:** everything is rendered in the inertial TEME frame; the Earth mesh rotates by GMST.
* **Charts:** hand-written SVG components (no chart library) so every mark is on-brand and
  screenshot-able at any size for the LinkedIn cards.
* **Fonts:** Space Grotesk (geometric sans, headings/UI) + JetBrains Mono (data), self-hosted
  through `@fontsource` — no third-party requests at runtime.

### Pipeline: Python package `raan`

| Module | Input | Output (committed, small) |
|---|---|---|
| `raan.catalog` | CelesTrak GP OMM CSV + SATCAT | `web/public/data/catalog.json` |
| `raan.collision` | ESA CDM dataset (Zenodo 4463683) | `collision.json` |
| `raan.maneuver` | TLE benchmark @ pinned commit | `maneuvers.json`, `maneuvers/<sat>.json` |
| `raan.intel` | the three artefacts above (+ archive diff) | `report.json`, `reports/*.md` |
| `raan.report` | all artefacts | `reports/RAAN_technical_report.pdf` |

Rules: raw downloads live in `data/raw/` (git-ignored) and are fetched by `make data`; every
artefact embeds the dataset version (DOI/md5/commit) and the code version; fixed seeds; `make
reproduce` rebuilds everything from scratch.

### Scheduled jobs

* `pages.yml` (cron once a day, and every push to `main`), three jobs:
  `build` (read-only token: one polite CelesTrak fetch → catalogue → intelligence report → site),
  `archive` (the only job with write access: appends the day's snapshot to the `data` branch) and
  `deploy` (GitHub Pages). Any non-200 answer from CelesTrak stops the fetch; the newest
  catalogue already built is published instead and nothing is archived that day.
* `ci.yml` (push/PR): ruff, pytest, vitest, type-check, production build.

### What is deliberately not here

No backend, no user accounts, no live conjunction screening, no proprietary data.
