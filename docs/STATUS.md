# Status — where to resume

_Read this first if you are a new session. Last update: 2026-11-12, end of the independent
pre-launch review._

**Branch with the reviewed work:** `claude/raan-pre-launch-review-8qqz4h` (contains
`claude/epic-volta-jjkxwt` plus the review). Not merged: merging, making the repository public
and enabling Pages are Diego's steps (`docs/PASOS_PARA_DIEGO.md`, steps 1 to 3).

## Pre-launch review: what was done

| Step | State | Evidence |
|---|---|---|
| 1 Security | **done** | Whole git history scanned: no keys, tokens or passwords. Fixed: absolute local paths inside the published `catalog.json`. Workflows: no default permissions, one job per privilege, actions pinned by SHA. Left to Diego: his personal e-mail is the author of the initial commit (PASOS step 1). |
| 2 Licences | **done** | Read on the primary sources on 12 Nov: Zenodo record (CC BY 4.0, md5 matches the download), Space-Track redistribution text, CelesTrak usage policy (no licence text; no redistribution clause). Manoeuvre benchmark: no licence at the pinned commit (= upstream HEAD) → reported manoeuvre times are no longer republished, only the bracketing element-set epochs. Pending: Diego's e-mail to the dataset author. |
| 3 Code review | **done** | Every Python module and the globe engine read line by line. L = 0.694 recomputed from the raw CSVs with an independent script. Collision run reproduced to four decimals (including the GRU). Manoeuvre run reproduced, then corrected (see below). Fixes listed in `docs/DECISIONS.md` 14 to 24. |
| 4 Traceability | **done** | Report, site, cards, README and the 13 posts checked against the artefacts. Hard-coded figures replaced by values read from `collision.json`, `maneuvers.json`, `catalog.json`, `verification.json`. Post 7's "0.607" is reproducible with `python -m raan.collision.replay_bug`. |
| 5 Performance | **done, software rendering only** | `web/scripts/perf.cjs`, 20,152 objects, SwiftShader: 14.2 → 32.7 fps (1366×768), 5.9 → 28.3 fps (1440×900 at 2×), 13.5 → 54 fps (phone viewport), all objects still drawn. Not measured on a real GPU or a real phone. |
| 6 Deploy | **rehearsed locally, never run on GitHub** | Clean clone, `pip install -e .`, the build job's commands run literally (real CelesTrak fetch, report, `npm ci`, build), the archive job's script against a local remote (first day, repeat, second day), and the refused-download path (HTTP 403 and network failure simulated). |
| 7 Defence dossier | **done** | `docs/DEFENSA.md` |
| 8 Posts | **done** | `content/CALENDARIO.md`; cards and manoeuvre video regenerated. |

## Metrics that changed in the review

| Metric | Before | After | Why |
|---|---|---|---|
| Manoeuvre F1, classifier / physics / CUSUM | 0.79 / 0.73 / 0.51 | **0.81 / 0.74 / 0.52** | 54 reported burns (34 events) lie outside the element-set history of their satellite; they were scored as misses. |
| Manoeuvre events | 837 | **803** | same |
| Semi-major axis only (ablation) | 0.78 | **0.79** | same |
| "5 of 45 burns under 1 m found" | claimed | **withdrawn** (11 real cases, 4 found) | 34 of the 45 were the unobservable burns above, measured as 0 m. Replaced by the noise floor (median 0.36 m, p95 4.1 m) and the 1–3 m recall (29/66). |
| Collision: all scores | — | unchanged | reproduced exactly |
| Collision: nested cross-validation of the gate | not computed | **1.23** (non-nested 0.98, naive 0.80) | added; strengthens the published conclusion |
| Manoeuvres: chance level | not computed | **F1 0.09** | added |
| SGP4 through the OMM route | not measured | **3.5e-5 km** (TLE route 1.2e-7 km) | added |

## How to run

```bash
make setup            # venv + npm
make data             # ESA CDM dataset (221 MB) + TLE benchmark
make reproduce        # collision + manoeuvres + report + verification + PDF + web build (~15 min)
make catalog          # live CelesTrak snapshot (max once per 2 h!)
cd web && npm run dev # http://localhost:5173
make test
```

## Verified vs not verified

**Verified by running it:** everything in the tables above; 62 Python tests and 7 web tests
pass; `ruff` clean; type-check and production build clean; no console errors on any page.

**Not verified:**

* Frame rate on a real GPU and on a real phone (PASOS step 4).
* `pages.yml` and `ci.yml` on GitHub itself, including the new action versions, the cache and
  the push to the `data` branch.
* The Claude path of the report editor with a real API key (tests use fake writers).
* SGP4's real-world accuracy (the literature value is quoted, not measured).
* The "Alpha-5" remark in `docs/DEFENSA.md` §5, post 1.
* TU Delft theses on manoeuvre detection: not read.
* Whether the benchmark's author agrees with publishing derived series.

## Known gaps / next steps

* The detector design (windows, matching rule) was tuned on the same 15 satellites.
* The cross-validated loss shown in the collision table is the non-nested one; the nested value
  is in the text and in `collision.json` (`selection.cv_L_gbm_gate_nested`).
* The web pages still contain em dashes in body text (only the posts and cards were cleaned).
* No Space-Track path (full ~35 k catalogue).
* Manoeuvre detection on the daily archive needs about 30 snapshots per object and has no labels.
* `docs/RESEARCH.md` and `docs/DECISIONS.md` are the assistant's working notes in its own
  first person; they say so at the top.
