# Phase 0 · Research

> Working notes written by the AI coding assistant (Claude Code) during the build session, in
> its own first person ("I"); "the brief" is Diego's written instructions to it. Re-checked on 12 Nov 2026 by a second, independent session:
> the Zenodo licence, the Space-Track redistribution text, the CelesTrak usage policy and the
> challenge paper's result table were read again on the primary sources.

_Last verified: 2026-11-11. Every claim below is tagged with how it was checked:_
**[V]** = read on the primary source during this session · **[S]** = seen only in search-engine
snippets, primary source not opened · **[A]** = my own analysis of downloaded data.

---

## 1. Data sources

### 1.1 CelesTrak GP data (the catalogue behind the globe)

| Item | Finding |
|---|---|
| Endpoint | `https://celestrak.org/NORAD/elements/gp.php?{QUERY}=VALUE[&FORMAT=VALUE]` with `QUERY ∈ {CATNR, INTDES, GROUP, NAME, SPECIAL}` (uppercase). **[V]** [gp-data-formats](https://celestrak.org/NORAD/documentation/gp-data-formats.php) |
| Formats | `TLE/3LE`, `2LE`, `XML` and `KVN` (CCSDS OMM), `JSON`, `JSON-PRETTY`, `CSV`. Default is CSV since 2026-05-09. **[V]** |
| **TLE is dead for new objects** | "We ran out of 5-digit catalog numbers on 2026-07-11 … All newly cataloged objects have 6-digit catalog numbers of 100000+ and GP data will not be available for them using the TLE format." **[V]** → the pipeline uses **OMM CSV only** and never parses TLE for live data. |
| Update rate | GP data is refreshed "once every 2 hours". **[V]** |
| Usage policy | "Only download the data you need … and only download data once per update." One-download-per-update is **enforced** for `GROUP=active` and Starlink (a second request returns HTTP 403 "GP data has not updated since your last successful download"). More than 50 HTTP errors in 2 h or >100 MB/day gets the IP firewalled. Software must stop on any non-200. **[V]** [usage-policy](https://celestrak.org/usage-policy.php) — I hit this 403 myself during this session. |
| Origin of the data | CelesTrak GP comes from 18 SDS via Space-Track ("fresh GP data (which we get from Space Track)"). **[V]** |
| Licence / redistribution | CelesTrak publishes no formal licence text; it states a "long tradition of making data freely available to all users". The underlying data is Space-Track "basic SSA data", for which USSPACECOM gives "express blanket approval for transfer/redistribution … conditioned on appropriate citation" (see 1.3). **[V]** → we redistribute a compact daily snapshot **with attribution to CelesTrak and 18 SDS/Space-Track**. |
| Is there an "everything" group? | **No.** The Current Data page lists ~48 groups (`active`, `analyst`, debris clouds `fengyun-1c-debris`, `cosmos-2251-debris`, `iridium-33-debris`, constellations…) but no "all catalogued objects" query. **[V]** Rocket bodies and most debris are not obtainable in bulk from CelesTrak. |
| SATCAT | `https://celestrak.org/pub/satcat.csv` — metadata for every catalogued object (owner, type, launch, decay, apogee/perigee, RCS). Updated once or twice a day. **[V]** |

**Consequence for "30,000 objects".** With CelesTrak alone the honest live catalogue is
`active ∪ analyst ∪ three debris clouds` (≈ 17–19 k objects; exact number is printed on the site
from the snapshot). The full ≈ 33 k on-orbit public catalogue needs a Space-Track account
(optional path, see 1.3). The 30 k / 60 fps requirement is a *rendering* requirement and is
verified with a stress mode that replicates real objects; the UI always shows the true count.

### 1.2 CelesTrak Supplemental GP (SupGP)

SupGP element sets are fitted by CelesTrak to **operator-supplied ephemerides** rather than to SSN
tracking: Starlink ("Derived from latest Starlink ephemeris data from SpaceX's public data
repository"), OneWeb, Kuiper, Planet, Iridium, SES, Telesat ("…on Space Track, with permission
from …"), GPS (SEM almanac), GLONASS, Intelsat. **[V]**
[supplemental](https://celestrak.org/NORAD/elements/supplemental/). Same formats and the same
2-hour politeness rule. SupGP for Starlink launches already uses 9-digit "launch nominal" catalogue
numbers (799xxxxxx) **[V]**. KESSLER/RAAN v1 uses standard GP for consistency (one source, one
quality level); SupGP is listed as future work for Starlink manoeuvre analysis because operator
ephemerides *include planned manoeuvres*, which changes what "detection" means.

### 1.3 Space-Track

* Requires a free account and acceptance of a User Agreement: "The User agrees not to transfer any
  data or technical information received from this website … to any other entity without prior
  express approval." **[V]** [space-track.org/documentation](https://www.space-track.org/documentation)
* **But** the same documentation states: "USSPACECOM has provided express blanket approval for
  transfer/redistribution of basic SSA data and services accessed via www.Space-Track.org
  conditioned on appropriate citation … Basic SSA data are Two-Line Elements (TLEs) and Orbital
  Mean-element Messages (OMMs); SATCAT; and Satellite Decay and Reentry Data." **[V]**
* CDMs, analyst-object ephemerides and anything under an SSA Sharing Agreement are **not** basic
  data and are not used anywhere in this project.
* Decision: Space-Track is an **optional** enrichment (full catalogue, historical GP). The project
  must build and run with zero accounts. **No Space-Track fetcher is implemented.**

### 1.4 ESA Collision Avoidance Challenge dataset

| Item | Finding |
|---|---|
| Record | Uriot, Izzo, Martinez-Heras, Letizia, Siminski, Merz — *Collision Avoidance Challenge dataset*, Zenodo, 2021-01-25, DOI [10.5281/zenodo.4463683](https://doi.org/10.5281/zenodo.4463683). **[V]** |
| Licence | **CC BY 4.0** (`license.id = cc-by-4.0` in the Zenodo API). Redistribution of the data and of derived tables is allowed with attribution. **[V]** |
| File | One zip, 221,128,642 bytes, md5 `d19dc8875229f2f6893253c38adddc87` (matches my download). **[V]** |
| Contents | `kelvins_competition_data/{train_data.zip, test_data.csv, test_data_private.csv}` and `raw_data/raw_data_2015-2019.gz`. **[A]** |
| Shape | train 162,634 CDMs / 13,154 events; test 24,484 CDMs / 2,167 events; 103 columns; `test_data_private.csv` has one row per test event with `true_risk`. **[A]**, matches the Kelvins page **[V]** |
| What it is | Anonymised Conjunction Data Messages received by ESA 2015–2019 for its LEO missions; `risk` is log10 of the collision probability computed by ESA; each event is a time series of CDMs. **[V]** |
| **Selection bias** | "the testing set and the training set have not been randomly sampled from the database … they have been hand picked in order to over-represent high risk events". Test events all have a final CDM within 1 day of TCA and **no** CDM closer than 2 days to TCA among the inputs; the training set is unfiltered. **[V]** [Kelvins · Data](https://kelvins.esa.int/collision-avoidance-challenge/data/) |
| Class balance | Only 365 of 13,154 training events (2.8 %) end with risk ≥ 1e-6. **[A]** |

Official score **[V]** [Kelvins · Scoring](https://kelvins.esa.int/collision-avoidance-challenge/scoring/):
`L = MSE_HR / F2`, where high-risk means final `r ≥ 1e-6`, `F2` is computed over all events on that
binary label, and `MSE_HR` is the mean squared error of log10 risk **only over truly high-risk
events**. Predictions are clipped (the paper uses ε = 0.001, i.e. to `[-6.001, …]` on the low side).

## 2. State of the art

### 2.1 Collision Avoidance Challenge results

Uriot et al., *Spacecraft Collision Avoidance Challenge: design and results of a machine learning
competition*, [arXiv:2008.03069](https://arxiv.org/abs/2008.03069) (Astrodynamics, 2022). **[V]**
(PDF read in this session.)

* 96–97 teams, 862 submissions, two months.
* **Latest Risk Prediction (LRP) baseline** = clipped naive forecast (the last risk available ≥ 2
  days before TCA): **L = 0.694** (MSE_HR 0.513, F2 0.739) on the full test set. "Out of the 97
  teams 12 managed to submit better solutions."
* Winner (*sesc*): L = 0.556 (MSE_HR 0.407, F2 0.733). Top three of Table 3: 0.556, 0.571, 0.585.
* The paper gives both "96 teams" (abstract) and "97 teams" (the sentence about the baselines).
* "many of the teams fail to obtain a better F2 value than the LRP baseline"; "most surveyed teams
  lamented a poor correlation between training and test sets performances"; 65 % framed the
  problem as static rather than as a time series — "a direct consequence of the great predictive
  strength of a naive forecast".

**What this means for this project.** The bar is not "train a model", it is "reproduce 0.694 exactly,
then report honestly whether anything beats it and why that is hard". Rule 4 of the brief is the
expected outcome, not an edge case.

### 2.2 Manoeuvre detection from TLE histories

* **Shorten et al., "Wide-scale Monitoring of Satellite Lifetimes: Pitfalls and a Benchmark
  Dataset"**, [arXiv:2212.08662](https://arxiv.org/abs/2212.08662) (J. Spacecraft & Rockets 2023).
  **[V]** Key points used here: TLE *mean* elements should be compared directly rather than
  osculating elements; SGP4 propagation residuals between consecutive element sets are the
  standard detection signal; ground truth is taken from the International DORIS Service
  (`ftp.ids-doris.org/pub/ids/satellites/`), TLEs from Space-Track (downloaded 2022-10-26).
* **Classical approach (Kelecy et al. 2007; Lemmens & Krag 2014; Li et al. 2018/2019)** — moving
  window statistics on semi-major axis / inclination and on propagation residuals; these are the
  references behind the "physics baseline". **[S]** — cited from the Shorten paper's related work;
  I did not open the original papers.
* **TU Delft.** `repository.tudelft.nl` was unreachable from this session (connection resets), so
  I could not read the theses. Search results show TU Delft MSc work on TLE-based manoeuvre
  detection, including a 2026 thesis "A Physics-Informed Approach to Low-Thrust Maneuver Detection
  and Thrust Recovery for SSA in GEO" (LSTM classifier + PINN, compared against a TLE
  sliding-window method and a UKF). **[S]**
  [record](https://repository.tudelft.nl/record/uuid:9e4d886c-fef2-4632-a3bd-7df0486a5a51).
  **Action for Diego:** read it (and its reference list) before any TU Delft interview; I only
  rely on the generic method — propagate element set *k* to the epoch of *k+1*, express the
  position difference in the RTN frame — which is standard and independent of that thesis.
* **Newer public datasets** — MAD-LEO (arXiv:2609.08556, 1,134 IDS-reported manoeuvres, 11
  satellites) and SpaceTrack-TimeSeries (arXiv:2506.13034). **[S]** Not used: licences and
  download locations not verified.

### 2.3 Competitors and neighbours (acknowledged, not rivalled)

| Who | What they do (vendor description) | Relation to this project |
|---|---|---|
| **GMV — Focusoc / FOCUSOC NXTGEN** | Operational collision-avoidance platform and service; multi-source data fusion. **[S]** | Operational, proprietary data. We are not this. |
| **Neuraspace** | AI-native STM platform: conjunction assessment, manoeuvre planning. **[S]** | Same. |
| **LeoLabs** | Own radar network, LEO tracking and conjunction alerts. **[S]** | They own sensors; we own none. |
| **Slingshot Aerospace (Beacon)** | Coordination/digital-twin software; TraCSS prime. **[S]** | Same. |
| **kesslerlib/kessler** | Open-source ML library for CDM forecasting (FDL Europe/ESA/Oxford). **[S]** | Closest open neighbour; also the reason for the rename (§5). |
| **KeepTrack** (AGPL), **Stuff in Space** | Open-source WebGL catalogue visualisers. **[S]** | Far more complete viewers. Our globe exists to give context to the research, not to out-feature them. |

Differentiation: **open, reproducible, explained** — every number on the site links to the script
and data version that produced it, including the negative results.

## 3. Manoeuvre data: histories and labels without non-redistributable data

**Labels that exist publicly.** Operators of DORIS-equipped missions publish manoeuvre logs through
the IDS. The Shorten benchmark
([github.com/dpshorten/TLE_observation_benchmark_dataset](https://github.com/dpshorten/TLE_observation_benchmark_dataset),
commit `5ea6489`, 2023-05-29) packages TLE histories and manoeuvre timestamps for **15 satellites**
(CryoSat-2, Jason-1/2/3, Sentinel-3A/3B/6A, SARAL, Haiyang-2A, TOPEX, Fengyun-2D/2E/2F/2H/4A). **[V]**
(cloned and inspected.)

* **Licence caveat:** the repository has **no LICENSE file** **[V]**. The TLEs inside are Space-Track
  basic SSA data (redistributable with citation, §1.3); the manoeuvre timestamps are facts published
  by IDS/operators. Decision: **do not vendor the repository.** `make data` clones it at the pinned
  commit; this repo only publishes *derived* products (detections, metrics, per-epoch mean-element
  series, and for each reported manoeuvre the pair of element-set epochs around it, not the
  reported time) with attribution. **Action for Diego (optional, polite):** e-mail the author to confirm he
  is happy with that.
* **Label quality:** LEO altimetry/geodesy missions → operator-reported burn times to the minute,
  the best public ground truth there is. The Fengyun GEO labels come from a different source and
  are coarser (many on the hour or half hour **[A]**). Everything here is *impulsive station-keeping
  on a handful of well-tracked science satellites* — it says little about low-thrust Starlink-style
  manoeuvring. This limitation is stated on the site.

**Forward archive (starts today).** `.github/workflows/pages.yml` (job `archive`) stores one compact CelesTrak
snapshot per day in the `data` branch. This gives redistributable GP histories for *every* object
from now on. Quality of what it will yield:

* **Histories:** one element set per object per day (CelesTrak serves only the latest); objects
  updated several times a day lose the intermediate sets. Good enough for the physics detector
  (LEO objects are typically updated 1–3×/day), not for sub-day timing.
* **Labels: none.** Detections on archived data are **unlabelled**. They are shown as "candidate
  manoeuvres" with their evidence, with precision/recall *transferred* from the labelled benchmark
  and flagged as such. For the ~8 benchmark satellites still flying, IDS logs can label new data
  later (manual download; IDS FTP is not reachable from CI).
* Usable depth: ≥ 30 days of archive are needed before the detector has a noise baseline per
  object. Until then the site shows the benchmark satellites only.

## 4. Scope decided

| Module | In scope (v1) | Explicitly out |
|---|---|---|
| Digital Twin | CelesTrak OMM snapshot (active + analyst + 3 debris clouds) joined with SATCAT; SGP4 in a worker; filters; time bar; orbit trace; object card with epoch age + source; Vallado verification in JS **and** Python. | Live observations; full debris catalogue without a Space-Track account; conjunction screening of the live catalogue. |
| Collision Lab | Exact LRP reproduction; constant baseline; LightGBM; GRU; official L, MSE_HR, F2, high-risk false negatives, calibration; bias analysis; interactive page. | Any claim of operational value; any claim about today's conjunctions. |
| Manoeuvres | Physics thresholds, CUSUM change detection, gradient-boosted classifier; leave-one-satellite-out evaluation on IDS labels; per-object timelines with evidence. | Low-thrust detection; labelled results on the live archive. |
| Intelligence | Deterministic fact extraction → agents → report; template mode by default, Claude optional with a numeric guard. | LLM-computed numbers. |
| Research | Experiments page, dataset versions, model cards, PDF report. | — |

## 5. Name check

"KESSLER" collides inside this exact niche **[S]**:

* **`kessler`** — Python library "for machine learning and simulation-based inference applied to
  space collision avoidance" (PyPI `kessler`, conda-forge, from FDL Europe with ESA). Same topic,
  same dataset family, the audience we want to impress knows it.
* **Kessler Aerospace / Kessler Space** — start-up(s) described as building collision-avoidance /
  space-traffic services.
* **KESSLER** — ASTREO debris-mapping CubeSat developed with ESA.

No trademark database was searched; this is a confusion risk assessment, not legal advice.

Alternatives considered: **RAAN** (Right Ascension of the Ascending Node — no SSA product found),
**VISVIVA** (a "Vis Viva Space" mission-planning start-up exists → rejected), **APOGEO** (Apogeo
Space, Italian IoT constellation → rejected).

**Decision: the product name is `RAAN · Open Orbital Intelligence Lab`.** The GitHub repository,
first kept as `kessler`, was renamed `raan` in November 2026 (DECISIONS #26). The brand and the
repository name live in two places (`web/src/brand.ts`, `raan/brand.py`); the site's base path is
not written anywhere and is read from GitHub Pages at deploy time.

## 6. Things in the brief I am changing, and why

1. **"All catalogued objects" → "all objects CelesTrak publishes in bulk"** (§1.1). Faking 30 k
   real objects would break honesty rule 3.
2. **TLE → OMM.** The brief says "GP/TLE"; TLE can no longer represent new objects (§1.1).
3. **Instanced meshes → one `gl.POINTS` draw call.** Same goal (30 k @ 60 fps), cheaper; see
   `ARCHITECTURE.md`.
4. **Name** (§5).
5. **Videos are captured frame-by-frame** from the app with a deterministic clock instead of
   screen-recorded: headless software WebGL cannot hold 30 fps, frame stepping gives clean 30 fps
   MP4s.
