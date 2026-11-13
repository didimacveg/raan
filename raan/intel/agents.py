"""The agents.

* ``CatalogWatch``   — what the catalogue looks like today and what changed since yesterday.
* ``ManeuverWatch``  — largest orbit changes since the previous snapshot + benchmark status.
* ``ConjunctionAnalyst`` — state of the collision-risk experiments on the ESA dataset.
* ``Reviewer``       — rejects findings that cite missing facts or contain unsupported numbers.
* ``Editor``         — turns accepted findings into prose (templates, or Claude with the number
                       guard and automatic fallback).

Analysts read artefacts written by the deterministic pipeline and register ``Fact`` objects.
They contain no modelling and no arithmetic beyond counting and sorting.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from raan.intel.core import FactStore, Finding, unsupported_numbers

SITE = "https://didimacveg.github.io/kessler/"
GP_QUERY = "https://celestrak.org/NORAD/elements/gp.php"
STALE_DAYS = 5.0
CHANGE_MIN_M = 100.0  # minimum |Δa| for an orbit change to be listed
CHANGE_MIN_PERIGEE_KM = 300.0  # below this, drag decay explains large changes


@dataclass
class Context:
    """Everything the agents may read."""

    catalog: dict | None = None
    collision: dict | None = None
    maneuvers: dict | None = None
    diff: dict | None = None  # raan.catalog.archive.diff output
    previous_date: str | None = None
    store: FactStore = field(default_factory=FactStore)


def load_json(path: Path) -> dict | None:
    return json.loads(path.read_text()) if path.exists() else None


class CatalogWatch:
    name = "catalog-watch"
    src = "web/public/data/catalog.json"

    def run(self, ctx: Context) -> list[Finding]:
        cat = ctx.catalog
        if cat is None:
            return []
        s, meta, cols, d = ctx.store, cat["meta"], cat["cols"], cat["dict"]
        link = SITE + "#/"
        s.add("catalog.date", meta["generated_at"], "Snapshot time (UTC)", self.src, link,
              text=meta["generated_at"].replace("T", " ").replace("Z", " UTC"))  # fmt: skip
        s.add("catalog.count", meta["count"], "Objects with public bulk GP data", self.src, link)
        s.add("catalog.on_orbit", meta["satcat_on_orbit"]["total"],
              "Objects on orbit in the SATCAT", self.src,
              "https://celestrak.org/satcat/")  # fmt: skip
        coverage = meta["count"] / max(meta["satcat_on_orbit"]["total"], 1)
        s.add("catalog.coverage", coverage, "Share of on-orbit objects shown", self.src, link,
              text=f"{coverage * 100:.0f}%")  # fmt: skip
        for key in ("active", "debris"):
            s.add(f"catalog.{key}", meta["by_type"].get(key, 0), f"{key} objects", self.src, link)
        s.add("catalog.leo", meta["by_regime"].get("LEO", 0), "Objects in LEO", self.src, link)
        s.add("catalog.geo", meta["by_regime"].get("GEO", 0), "Objects in GEO", self.src, link)
        age_h = meta["epoch_age_days"]["median"] * 24
        s.add("catalog.median_age_h", age_h, "Median element-set age (hours)", self.src, link,
              text=f"{age_h:.1f}")  # fmt: skip
        gen = _unix(meta["generated_at"])
        stale = sum(1 for ep in cols["epoch"] if (gen - ep) / 86400.0 > STALE_DAYS)
        s.add("catalog.stale", stale, f"Objects whose elements are older than {STALE_DAYS:g} days",
              self.src, link)  # fmt: skip
        s.add("catalog.six_digit", meta["six_digit_ids"],
              "Objects with a 6-digit catalogue number (cannot be written as a TLE)", self.src,
              "https://celestrak.org/NORAD/documentation/gp-data-formats.php")  # fmt: skip
        cons = Counter(d["cons"][c] for c in cols["cons"] if d["cons"][c])
        (top_name, top_n), *_ = cons.most_common(1) or [("none", 0)]
        s.add("catalog.top_constellation", top_name, "Largest constellation", self.src, link)
        s.add("catalog.top_constellation_n", top_n, f"{top_name} objects", self.src, link)
        share = top_n / max(meta["by_type"].get("active", 1), 1)
        s.add("catalog.top_constellation_share", share, f"{top_name} share of active payloads",
              self.src, link, text=f"{share * 100:.0f}%")  # fmt: skip

        findings = [
            Finding(
                self.name,
                "Catalogue snapshot",
                "The {catalog.date} snapshot holds {catalog.count} objects with public bulk "
                "elements, {catalog.coverage} of the {catalog.on_orbit} objects on orbit in the "
                "SATCAT: {catalog.active} active payloads and {catalog.debris} debris fragments. "
                "{catalog.leo} are in LEO and {catalog.geo} in the geosynchronous belt.",
                [
                    "catalog.date",
                    "catalog.count",
                    "catalog.coverage",
                    "catalog.on_orbit",
                    "catalog.active",
                    "catalog.debris",
                    "catalog.leo",
                    "catalog.geo",
                ],
                priority=0,
                caveat="Positions on the site are SGP4 propagations of these elements, not "
                "observations.",
            ),  # fmt: skip
            Finding(
                self.name,
                "Constellations",
                "{catalog.top_constellation} alone accounts for {catalog.top_constellation_n} "
                "objects, {catalog.top_constellation_share} of all active payloads in the "
                "snapshot.",
                [
                    "catalog.top_constellation",
                    "catalog.top_constellation_n",
                    "catalog.top_constellation_share",
                ],
            ),  # fmt: skip
            Finding(
                self.name,
                "Data freshness",
                "The median element set is {catalog.median_age_h} hours old. {catalog.stale} "
                "objects have elements older than 5 days; their propagated positions are "
                "indicative only. {catalog.six_digit} objects carry a 6-digit catalogue number "
                "and exist only in OMM formats.",
                ["catalog.median_age_h", "catalog.stale", "catalog.six_digit"],
            ),
        ]
        if ctx.diff is not None:
            src = "data branch (daily snapshots)"
            s.add("diff.previous", ctx.previous_date or "previous snapshot",
                  "Previous snapshot", src)  # fmt: skip
            s.add("diff.new", len(ctx.diff["new"]), "Objects that appeared", src, link)
            s.add("diff.gone", len(ctx.diff["gone"]), "Objects no longer listed", src, link)
            s.add("diff.updated", ctx.diff["updated"], "Objects with a newer element set", src)
            findings.append(
                Finding(
                    self.name,
                    "Changes since the previous snapshot",
                    "Since {diff.previous}: objects that appeared: {diff.new}; no longer "
                    "listed: {diff.gone}; with a newer element set: {diff.updated}.",
                    ["diff.previous", "diff.new", "diff.gone", "diff.updated"],
                    caveat="An object leaving the list can mean decay, loss of tracking or a "
                    "change of CelesTrak group; the snapshot alone cannot tell which.",
                )  # fmt: skip
            )
        return findings


class ManeuverWatch:
    name = "maneuver-watch"
    src = "web/public/data/maneuvers.json"

    def run(self, ctx: Context) -> list[Finding]:
        findings: list[Finding] = []
        s = ctx.store
        if ctx.maneuvers is not None:
            m = ctx.maneuvers
            link = SITE + "#/maneuvers"
            for key in ("ml", "physics", "cusum"):
                for metric in ("precision", "recall", "f1"):
                    s.add(f"man.{key}.{metric}", m["summary"][key]["ALL"][metric],
                          f"{key} detector, {metric} (all satellites)", self.src, link,
                          text=f"{m['summary'][key]['ALL'][metric]:.2f}")  # fmt: skip
            s.add("man.events", m["totals"]["maneuver_events"], "Reported manoeuvre events",
                  self.src, link)  # fmt: skip
            s.add("man.sats", m["totals"]["satellites"], "Benchmark satellites", self.src, link)
            s.add("man.a_only.f1", m["physics_ablation"]["a"]["ALL"]["f1"],
                  "Semi-major-axis-only detector, F1", self.src, link,
                  text=f"{m['physics_ablation']['a']['ALL']['f1']:.2f}")  # fmt: skip
            findings.append(
                Finding(
                    self.name,
                    "Detector benchmark",
                    "On {man.events} operator-reported manoeuvre events of {man.sats} "
                    "satellites, evaluated leave-one-satellite-out, the classifier reaches F1 "
                    "{man.ml.f1} (precision {man.ml.precision}, recall {man.ml.recall}), the "
                    "physics baseline {man.physics.f1} and CUSUM {man.cusum.f1}. A detector "
                    "using only the step in semi-major axis reaches {man.a_only.f1}.",
                    [
                        "man.events",
                        "man.sats",
                        "man.ml.f1",
                        "man.ml.precision",
                        "man.ml.recall",
                        "man.physics.f1",
                        "man.cusum.f1",
                        "man.a_only.f1",
                    ],
                    caveat="Benchmark satellites perform impulsive station-keeping; low-thrust "
                    "manoeuvres are not covered.",
                )  # fmt: skip
            )
        if ctx.diff is not None and ctx.catalog is not None:
            cols, d = ctx.catalog["cols"], ctx.catalog["dict"]
            active = d["type"].index("active")
            leo = d["regime"].index("LEO")
            # LEO only: in high or eccentric orbits (e.g. MMS, a ~ 100,000 km) two consecutive
            # element sets differ by tens of km of semi-major axis from fitting noise alone.
            ranked = sorted(
                (
                    c for c in ctx.diff["changes"]
                    if cols["type"][c["index"]] == active
                    and cols["regime"][c["index"]] == leo
                    and abs(c["da_m"]) >= CHANGE_MIN_M
                    and c["perigee_km"] >= CHANGE_MIN_PERIGEE_KM
                ),
                key=lambda c: -abs(c["da_m"]),
            )  # fmt: skip
            src = "data branch (daily snapshots)"
            s.add("change.count", len(ranked),
                  f"Active LEO payloads whose mean semi-major axis changed by ≥ {CHANGE_MIN_M:g} m",
                  src, SITE + "#/")  # fmt: skip
            parts, ids = [], ["change.count"]
            for rank, c in enumerate(ranked[:5], start=1):
                k = c["index"]
                s.add(f"change.{rank}.name", cols["name"][k], "Object", src,
                      f"{GP_QUERY}?CATNR={c['id']}&FORMAT=CSV")  # fmt: skip
                s.add(f"change.{rank}.da_km", c["da_m"] / 1000.0,
                      f"Change in mean semi-major axis of {cols['name'][k]} (km)", src,
                      text=f"{c['da_m'] / 1000.0:+.2f}")  # fmt: skip
                parts.append(f"{{change.{rank}.name}} ({{change.{rank}.da_km}} km)")
                ids += [f"change.{rank}.name", f"change.{rank}.da_km"]
            listing = "; ".join(parts)
            findings.append(
                Finding(
                    self.name,
                    "Orbit changes since the previous snapshot",
                    "{change.count} active LEO payloads with perigee above 300 km changed their "
                    "mean semi-major axis by at least 100 m between snapshots."
                    + (f" Largest: {listing}." if parts else ""),
                    ids,
                    caveat="These are differences between two published element sets, not "
                    "validated manoeuvre detections: one pair has no noise baseline, and an "
                    "orbit-determination update produces the same signature. Most entries are "
                    "satellites raising or lowering their orbit after launch or before disposal. "
                    "The benchmarked detector needs about 30 daily snapshots per object.",
                )  # fmt: skip
            )
        return findings


class ConjunctionAnalyst:
    name = "conjunction-analyst"
    src = "web/public/data/collision.json"

    def run(self, ctx: Context) -> list[Finding]:
        c = ctx.collision
        if c is None:
            return []
        s = ctx.store
        link = SITE + "#/collision"
        by = {r["key"]: r for r in c["results"]}
        for key in by:
            s.add(f"col.{key}.L", by[key]["L"], f"{by[key]['name']}: challenge loss L (test)",
                  self.src, link, text=f"{by[key]['L']:.3f}")  # fmt: skip
        gate, lrp = by["gbm_gate"], by["lrp"]
        s.add("col.gate.cv", gate["cv_L"], "Gate model, cross-validated L", self.src, link,
              text=f"{gate['cv_L']:.2f}")  # fmt: skip
        s.add("col.lrp.cv", lrp["cv_L"], "Naive forecast, cross-validated L", self.src, link,
              text=f"{lrp['cv_L']:.2f}")  # fmt: skip
        s.add("col.gate.p_better", gate["p_better_than_reference"],
              "Share of bootstrap resamples where the gate beats the naive forecast", self.src,
              link, text=f"{gate['p_better_than_reference'] * 100:.0f}%")  # fmt: skip
        s.add("col.lrp.fn", lrp["fn"], "High-risk events missed by the naive forecast", self.src,
              link)  # fmt: skip
        s.add("col.gate.fn", gate["fn"], "High-risk events missed by the gate", self.src, link)
        s.add("col.gate.fp", gate["fp"], "False alarms of the gate", self.src, link)
        s.add("col.lrp.fp", lrp["fp"], "False alarms of the naive forecast", self.src, link)
        s.add("col.hr", c["dataset"]["test"]["events_high_risk"], "High-risk test events",
              self.src, link)  # fmt: skip
        s.add("col.test_events", c["dataset"]["test"]["events"], "Test events", self.src, link)
        s.add("col.train_hr", c["dataset"]["train"]["events_protocol_high_risk"],
              "High-risk training events under test conditions", self.src, link)  # fmt: skip
        s.add("col.prev_train", c["dataset"]["train"]["prevalence_protocol"],
              "High-risk prevalence, training", self.src, link,
              text=f"{c['dataset']['train']['prevalence_protocol'] * 100:.1f}%")  # fmt: skip
        s.add("col.prev_test", c["dataset"]["test"]["prevalence"],
              "High-risk prevalence, test", self.src, link,
              text=f"{c['dataset']['test']['prevalence'] * 100:.1f}%")  # fmt: skip
        return [
            Finding(
                self.name,
                "Collision-risk models vs the naive forecast",
                "On the ESA challenge test set ({col.test_events} events, {col.hr} high-risk) "
                "the naive forecast scores L = {col.lrp.L}, matching the published value. The "
                "LightGBM gate scores {col.gbm_gate.L} on the test set but {col.gate.cv} against "
                "{col.lrp.cv} in cross-validation, and wins in {col.gate.p_better} of bootstrap "
                "resamples. It is not reported as an improvement.",
                [
                    "col.test_events",
                    "col.hr",
                    "col.lrp.L",
                    "col.gbm_gate.L",
                    "col.gate.cv",
                    "col.lrp.cv",
                    "col.gate.p_better",
                ],
                priority=0,
            ),  # fmt: skip
            Finding(
                self.name,
                "Missed high-risk events",
                "The naive forecast misses {col.lrp.fn} of the {col.hr} high-risk events with "
                "{col.lrp.fp} false alarms; the gate misses {col.gate.fn} with {col.gate.fp} "
                "false alarms.",
                ["col.lrp.fn", "col.hr", "col.lrp.fp", "col.gate.fn", "col.gate.fp"],
            ),
            Finding(
                self.name,
                "Dataset bias",
                "Only {col.train_hr} training events are high-risk under test conditions "
                "({col.prev_train}), against {col.prev_test} in the test set.",
                ["col.train_hr", "col.prev_train", "col.prev_test"],
                priority=2,
                caveat="ESA states that the sets were hand-picked to over-represent high-risk "
                "events; results do not transfer to operational prevalence.",
            ),
        ]


@dataclass
class Review:
    accepted: list[Finding]
    rejected: list[tuple[Finding, str]]


class Reviewer:
    """Gatekeeper: a finding passes only if every cited fact exists and every number in its
    rendered text is supported by those facts."""

    name = "reviewer"

    def run(self, findings: list[Finding], store: FactStore) -> Review:
        accepted, rejected = [], []
        for f in findings:
            missing = [i for i in f.fact_ids if i not in store]
            if missing:
                rejected.append((f, f"missing facts: {missing}"))
                continue
            try:
                text = f.render(store)
            except KeyError as exc:
                rejected.append((f, f"template uses an uncited fact: {exc}"))
                continue
            if "{" in text or "}" in text:
                rejected.append((f, "unfilled placeholder in rendered text"))
                continue
            bad = unsupported_numbers(text, [store[i] for i in f.fact_ids], extra_allowed={"300"})
            if bad:
                rejected.append((f, f"unsupported numbers: {bad}"))
                continue
            accepted.append(f)
        return Review(accepted, rejected)


def _unix(iso: str) -> float:
    from datetime import UTC, datetime

    return datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC).timestamp()
