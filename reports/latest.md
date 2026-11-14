# RAAN orbital intelligence report

_2026-11-12 16:27:28 UTC · written by: template · Research project, not for operational use._

## Catalogue watch

**Catalogue snapshot.** The 2026-11-11 22:42:12 UTC snapshot holds 20,152 objects with public bulk elements, 57% of the 35,194 objects on orbit in the SATCAT: 16,894 active payloads and 2,675 debris fragments. 19,271 are in LEO and 585 in the geosynchronous belt.

> Caveat: Positions on the site are SGP4 propagations of these elements, not observations.

**Constellations.** Starlink alone accounts for 11,195 objects, 66% of all active payloads in the snapshot.

**Data freshness.** The median element set is 16.0 hours old. 312 objects have elements older than 5 days; their propagated positions are indicative only. 1,373 objects carry a 6-digit catalogue number and exist only in OMM formats.

## Manoeuvre watch

**Detector benchmark.** On 803 operator-reported manoeuvre events of 15 satellites, evaluated leave-one-satellite-out, the classifier reaches F1 0.81 (precision 0.83, recall 0.80), the physics baseline 0.74 and CUSUM 0.52. A detector using only the step in semi-major axis reaches 0.79.

> Caveat: Benchmark satellites perform impulsive station-keeping; low-thrust manoeuvres are not covered.

## Conjunction research

**Collision-risk models vs the naive forecast.** On the ESA challenge test set (2,167 events, 150 high-risk) the naive forecast scores L = 0.694, matching the published value. The LightGBM gate scores 0.627 on the test set but 0.98 against 0.80 in cross-validation, and wins in 86% of bootstrap resamples. It is not reported as an improvement.

**Missed high-risk events.** The naive forecast misses 35 of the 150 high-risk events with 63 false alarms; the gate misses 13 with 185 false alarms.

**Dataset bias.** Only 66 training events are high-risk under test conditions (0.8%), against 6.9% in the test set.

> Caveat: ESA states that the sets were hand-picked to over-represent high-risk events; results do not transfer to operational prevalence.

## Sources

| Fact | Value | Source |
|---|---|---|
| active objects | 16,894 | [web/public/data/catalog.json](https://didimacveg.github.io/raan/#/) |
| Objects with public bulk GP data | 20,152 | [web/public/data/catalog.json](https://didimacveg.github.io/raan/#/) |
| Share of on-orbit objects shown | 57% | [web/public/data/catalog.json](https://didimacveg.github.io/raan/#/) |
| Snapshot time (UTC) | 2026-11-11 22:42:12 UTC | [web/public/data/catalog.json](https://didimacveg.github.io/raan/#/) |
| debris objects | 2,675 | [web/public/data/catalog.json](https://didimacveg.github.io/raan/#/) |
| Objects in GEO | 585 | [web/public/data/catalog.json](https://didimacveg.github.io/raan/#/) |
| Objects in LEO | 19,271 | [web/public/data/catalog.json](https://didimacveg.github.io/raan/#/) |
| Median element-set age (hours) | 16.0 | [web/public/data/catalog.json](https://didimacveg.github.io/raan/#/) |
| Objects on orbit in the SATCAT | 35,194 | [web/public/data/catalog.json](https://celestrak.org/satcat/) |
| Objects with a 6-digit catalogue number (cannot be written as a TLE) | 1,373 | [web/public/data/catalog.json](https://celestrak.org/NORAD/documentation/gp-data-formats.php) |
| Objects whose elements are older than 5 days | 312 | [web/public/data/catalog.json](https://didimacveg.github.io/raan/#/) |
| Largest constellation | Starlink | [web/public/data/catalog.json](https://didimacveg.github.io/raan/#/) |
| Starlink objects | 11,195 | [web/public/data/catalog.json](https://didimacveg.github.io/raan/#/) |
| Starlink share of active payloads | 66% | [web/public/data/catalog.json](https://didimacveg.github.io/raan/#/) |
| Gate model, cross-validated L | 0.98 | [web/public/data/collision.json](https://didimacveg.github.io/raan/#/collision) |
| High-risk events missed by the gate | 13 | [web/public/data/collision.json](https://didimacveg.github.io/raan/#/collision) |
| False alarms of the gate | 185 | [web/public/data/collision.json](https://didimacveg.github.io/raan/#/collision) |
| Share of bootstrap resamples where the gate beats the naive forecast | 86% | [web/public/data/collision.json](https://didimacveg.github.io/raan/#/collision) |
| LightGBM gate + value: challenge loss L (test) | 0.627 | [web/public/data/collision.json](https://didimacveg.github.io/raan/#/collision) |
| High-risk test events | 150 | [web/public/data/collision.json](https://didimacveg.github.io/raan/#/collision) |
| Latest risk (naive forecast): challenge loss L (test) | 0.694 | [web/public/data/collision.json](https://didimacveg.github.io/raan/#/collision) |
| Naive forecast, cross-validated L | 0.80 | [web/public/data/collision.json](https://didimacveg.github.io/raan/#/collision) |
| High-risk events missed by the naive forecast | 35 | [web/public/data/collision.json](https://didimacveg.github.io/raan/#/collision) |
| False alarms of the naive forecast | 63 | [web/public/data/collision.json](https://didimacveg.github.io/raan/#/collision) |
| High-risk prevalence, test | 6.9% | [web/public/data/collision.json](https://didimacveg.github.io/raan/#/collision) |
| High-risk prevalence, training | 0.8% | [web/public/data/collision.json](https://didimacveg.github.io/raan/#/collision) |
| Test events | 2,167 | [web/public/data/collision.json](https://didimacveg.github.io/raan/#/collision) |
| High-risk training events under test conditions | 66 | [web/public/data/collision.json](https://didimacveg.github.io/raan/#/collision) |
| Semi-major-axis-only detector, F1 | 0.79 | [web/public/data/maneuvers.json](https://didimacveg.github.io/raan/#/maneuvers) |
| cusum detector, f1 (all satellites) | 0.52 | [web/public/data/maneuvers.json](https://didimacveg.github.io/raan/#/maneuvers) |
| Reported manoeuvre events | 803 | [web/public/data/maneuvers.json](https://didimacveg.github.io/raan/#/maneuvers) |
| ml detector, f1 (all satellites) | 0.81 | [web/public/data/maneuvers.json](https://didimacveg.github.io/raan/#/maneuvers) |
| ml detector, precision (all satellites) | 0.83 | [web/public/data/maneuvers.json](https://didimacveg.github.io/raan/#/maneuvers) |
| ml detector, recall (all satellites) | 0.80 | [web/public/data/maneuvers.json](https://didimacveg.github.io/raan/#/maneuvers) |
| physics detector, f1 (all satellites) | 0.74 | [web/public/data/maneuvers.json](https://didimacveg.github.io/raan/#/maneuvers) |
| Benchmark satellites | 15 | [web/public/data/maneuvers.json](https://didimacveg.github.io/raan/#/maneuvers) |
