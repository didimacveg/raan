"""Build the compact catalogue the web app loads (``web/public/data/catalog.json``).

Input: OMM CSV files from CelesTrak GP groups + the CelesTrak SATCAT.
Output: one columnar JSON with mean elements (enough to initialise SGP4 in the browser), the
classification labels used by the filters, and provenance (source, download time, element epoch).

Run: ``python -m raan.catalog.build [--fetch]``
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from raan.catalog import classify
from raan.catalog.fetch import GP_GROUPS, fetch_all, load_manifest
from raan.paths import RAW, WEB_DATA, ensure

SOURCE_NOTE = (
    "GP mean elements from CelesTrak (celestrak.org), derived from 18 SDS / Space-Track.org "
    "data; metadata from the CelesTrak SATCAT. Positions are SGP4 propagations of these "
    "published elements, not live observations."
)


def parse_epoch(text: str) -> float:
    """OMM epoch (UTC, ISO 8601 without zone) → Unix seconds."""
    text = text.strip().rstrip("Z")
    fmt = "%Y-%m-%dT%H:%M:%S.%f" if "." in text else "%Y-%m-%dT%H:%M:%S"
    return datetime.strptime(text, fmt).replace(tzinfo=UTC).timestamp()


def read_gp_csv(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def read_satcat(path: Path) -> dict[int, dict]:
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        if "NORAD_CAT_ID" not in (reader.fieldnames or []):
            return {}  # an error page saved as satcat.csv
        return {int(row["NORAD_CAT_ID"]): row for row in reader}


def valid_gp(row: dict) -> bool:
    """Reject rows SGP4 cannot use (missing or non-physical elements)."""
    try:
        n = float(row["MEAN_MOTION"])
        e = float(row["ECCENTRICITY"])
        parse_epoch(row["EPOCH"])
        float(row["INCLINATION"])
    except (KeyError, ValueError):
        return False
    return n > 0.0 and 0.0 <= e < 1.0 and math.isfinite(n)


def merge_groups(groups: dict[str, list[dict]]) -> tuple[list[dict], set[int]]:
    """Union of GP rows keyed by catalogue number; the most recent epoch wins.

    Returns the merged rows and the set of catalogue numbers present in the ``active`` group.
    """
    merged: dict[int, dict] = {}
    active_ids: set[int] = set()
    for group, rows in groups.items():
        for row in rows:
            if not valid_gp(row):
                continue
            cat = int(row["NORAD_CAT_ID"])
            if group == "active":
                active_ids.add(cat)
            row = dict(row, _group=group)
            if cat not in merged or parse_epoch(row["EPOCH"]) > parse_epoch(merged[cat]["EPOCH"]):
                merged[cat] = row
    return [merged[k] for k in sorted(merged)], active_ids


def incomplete_inputs(groups: dict[str, list[dict]], satcat: dict[int, dict]) -> list[str]:
    """Reasons why the downloaded files cannot give a complete catalogue (empty = fine).

    A 200 answer with an error page instead of CSV, or a group that failed to download, would
    otherwise shrink the catalogue without any error.
    """
    problems = []
    for group in GP_GROUPS:
        rows = groups.get(group)
        if rows is None:
            problems.append(f"gp_{group}.csv is missing")
        elif not any(valid_gp(row) for row in rows):
            problems.append(f"gp_{group}.csv has no valid element set")
    if not satcat:
        problems.append("satcat.csv is missing or empty")
    return problems


EXIT_NOT_REFRESHED = 3  # inputs incomplete: nothing was rebuilt, the previous catalogue stands


def adopt_newer(candidate: Path, out: Path) -> bool:
    """Copy ``candidate`` over ``out`` if it is a valid catalogue with a later snapshot time."""
    try:
        cand = json.loads(candidate.read_text())
        cand_time = cand["meta"]["generated_at"]
        if not cand["cols"]["id"]:
            return False
    except (OSError, ValueError, KeyError, TypeError):
        return False
    try:
        current_time = json.loads(out.read_text())["meta"]["generated_at"]
    except (OSError, ValueError, KeyError, TypeError):
        current_time = ""
    if cand_time <= current_time:  # ISO 8601 UTC strings sort chronologically
        return False
    ensure(out.parent)
    out.write_text(json.dumps(cand, separators=(",", ":")))
    return True


def _index(values: list[str]) -> tuple[list[str], list[int]]:
    """Dictionary-encode a string column (most frequent first)."""
    order = [v for v, _ in Counter(values).most_common()]
    lookup = {v: i for i, v in enumerate(order)}
    return order, [lookup[v] for v in values]


def build_catalog(
    groups: dict[str, list[dict]],
    satcat: dict[int, dict],
    generated_at: datetime,
    fetch_manifest: list[dict] | None = None,
) -> dict:
    rows, active_ids = merge_groups(groups)
    cols: dict[str, list] = {
        k: []
        for k in (
            "id name intl epoch n e i raan argp ma bstar ndot nddot "
            "type regime cons owner group launch rcs"
        ).split()
    }
    for row in rows:
        cat = int(row["NORAD_CAT_ID"])
        meta = satcat.get(cat, {})
        n, e, inc = float(row["MEAN_MOTION"]), float(row["ECCENTRICITY"]), float(row["INCLINATION"])
        name = (row.get("OBJECT_NAME") or meta.get("OBJECT_NAME") or f"OBJECT {cat}").strip()
        cols["id"].append(cat)
        cols["name"].append(name)
        cols["intl"].append((row.get("OBJECT_ID") or meta.get("OBJECT_ID") or "").strip())
        cols["epoch"].append(round(parse_epoch(row["EPOCH"]), 3))
        cols["n"].append(n)
        cols["e"].append(e)
        cols["i"].append(inc)
        cols["raan"].append(float(row["RA_OF_ASC_NODE"]))
        cols["argp"].append(float(row["ARG_OF_PERICENTER"]))
        cols["ma"].append(float(row["MEAN_ANOMALY"]))
        cols["bstar"].append(float(row.get("BSTAR") or 0.0))
        cols["ndot"].append(float(row.get("MEAN_MOTION_DOT") or 0.0))
        cols["nddot"].append(float(row.get("MEAN_MOTION_DDOT") or 0.0))
        cols["type"].append(
            classify.object_type(
                meta.get("OBJECT_TYPE"), meta.get("OPS_STATUS_CODE"), cat in active_ids
            )
        )
        cols["regime"].append(classify.regime(n, e, inc))
        cols["cons"].append(classify.constellation(name))
        cols["owner"].append(classify.owner_name(meta.get("OWNER")))
        cols["group"].append(row["_group"])
        launch = (meta.get("LAUNCH_DATE") or "")[:4]
        cols["launch"].append(int(launch) if launch.isdigit() else 0)
        try:
            cols["rcs"].append(round(float(meta.get("RCS") or 0.0), 3))
        except ValueError:
            cols["rcs"].append(0.0)

    dictionaries = {}
    for key, fixed in (
        ("type", list(classify.OBJECT_TYPES)),
        ("regime", list(classify.REGIMES)),
    ):
        lookup = {v: i for i, v in enumerate(fixed)}
        dictionaries[key] = fixed
        cols[key] = [lookup[v] for v in cols[key]]
    for key in ("cons", "owner", "group"):
        dictionaries[key], cols[key] = _index(cols[key])

    epochs = cols["epoch"]
    gen_ts = generated_at.timestamp()
    ages_days = sorted((gen_ts - ep) / 86400.0 for ep in epochs)
    type_counts = Counter(dictionaries["type"][t] for t in cols["type"])
    regime_counts = Counter(dictionaries["regime"][r] for r in cols["regime"])

    # SATCAT context: how much of the public on-orbit population the snapshot covers.
    on_orbit = [
        m for m in satcat.values() if not m.get("DECAY_DATE") and m.get("ORBIT_CENTER") == "EA"
    ]
    satcat_counts = Counter(m.get("OBJECT_TYPE", "UNK") for m in on_orbit)

    meta = {
        "generated_at": generated_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": SOURCE_NOTE,
        "source_urls": {
            "gp": "https://celestrak.org/NORAD/elements/",
            "satcat": "https://celestrak.org/satcat/",
            "policy": "https://celestrak.org/usage-policy.php",
        },
        "groups": {g: len(r) for g, r in groups.items()},
        "fetch": fetch_manifest or [],
        "count": len(rows),
        "by_type": dict(type_counts),
        "by_regime": dict(regime_counts),
        "epoch_min": min(epochs) if epochs else None,
        "epoch_max": max(epochs) if epochs else None,
        "epoch_age_days": {
            "median": round(ages_days[len(ages_days) // 2], 3) if ages_days else None,
            "p95": round(ages_days[int(len(ages_days) * 0.95)], 3) if ages_days else None,
            "max": round(ages_days[-1], 3) if ages_days else None,
        },
        "satcat_on_orbit": {
            "total": len(on_orbit),
            "payloads": satcat_counts.get("PAY", 0),
            "rocket_bodies": satcat_counts.get("R/B", 0),
            "debris": satcat_counts.get("DEB", 0),
            "max_catalog_number": max(satcat) if satcat else None,
        },
        "six_digit_ids": sum(1 for c in cols["id"] if c > 99999),
        "disclaimer": "Research project, not for operational use.",
    }
    return {"meta": meta, "dict": dictionaries, "cols": cols}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="download from CelesTrak first")
    parser.add_argument("--raw", type=Path, default=RAW / "celestrak")
    parser.add_argument("--out", type=Path, default=WEB_DATA / "catalog.json")
    parser.add_argument("--archive", type=Path, default=None, help="also write a daily snapshot")
    parser.add_argument(
        "--fallback",
        type=Path,
        default=None,
        help="catalogue saved by a previous run; used if the fetch fails and it is newer",
    )
    parser.add_argument(
        "--allow-partial", action="store_true", help="development only: build without `active`"
    )
    args = parser.parse_args()

    if args.fetch:
        for result in fetch_all(args.raw):
            print(f"  {result.name:22s} {result.status:12s} {result.http_status} {result.detail}")
    groups = {}
    for group in GP_GROUPS:
        path = args.raw / f"gp_{group}.csv"
        if path.exists():
            groups[group] = read_gp_csv(path)
    satcat = read_satcat(args.raw / "satcat.csv") if (args.raw / "satcat.csv").exists() else {}
    problems = incomplete_inputs(groups, satcat)
    if problems and not args.allow_partial:
        # Never publish a silently smaller catalogue: the previous one is kept instead.
        print(
            f"incomplete CelesTrak inputs in {args.raw}: {'; '.join(problems)}. Run with --fetch "
            "(CelesTrak allows one download of the big groups per 2-hour update)."
        )
        if args.fallback is not None and adopt_newer(args.fallback, args.out):
            print(f"using the newer catalogue saved by a previous run ({args.fallback})")
        raise SystemExit(EXIT_NOT_REFRESHED)
    newest = max((args.raw / f"gp_{g}.csv").stat().st_mtime for g in groups)
    catalog = build_catalog(
        groups, satcat, datetime.fromtimestamp(newest, UTC), load_manifest(args.raw)
    )
    ensure(args.out.parent)
    args.out.write_text(json.dumps(catalog, separators=(",", ":")))
    if args.archive is not None:
        from raan.catalog.archive import write_snapshot

        print(f"archive snapshot → {write_snapshot(catalog, args.archive)}")
    m = catalog["meta"]
    print(f"catalog: {m['count']} objects → {args.out} ({args.out.stat().st_size / 1e6:.2f} MB)")
    print(f"  by type   {m['by_type']}")
    print(f"  by regime {m['by_regime']}")
    print(f"  element age (days) {m['epoch_age_days']}")


if __name__ == "__main__":
    main()
