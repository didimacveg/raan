"""Daily snapshots of the catalogue: the forward archive that makes change detection possible.

One gzip CSV per day (``YYYY-MM-DD.csv.gz``, ~0.7 MB) with the mean elements of every object.
The daily workflow stores them on the ``data`` branch.
"""

from __future__ import annotations

import csv
import gzip
import io
from datetime import UTC, datetime
from pathlib import Path

from raan.catalog.classify import semi_major_axis_km

COLUMNS = ("id", "epoch", "n", "e", "i", "raan", "argp", "ma", "bstar")


def write_snapshot(catalog: dict, directory: Path) -> Path:
    cols = catalog["cols"]
    day = catalog["meta"]["generated_at"][:10]
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{day}.csv.gz"
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(COLUMNS)
    for k in range(len(cols["id"])):
        writer.writerow([cols[c][k] for c in COLUMNS])
    with gzip.GzipFile(path, "wb", mtime=0) as fh:  # mtime=0 → byte-identical re-runs
        fh.write(buf.getvalue().encode())
    return path


def load_snapshot(path: Path) -> dict[int, dict[str, float]]:
    with gzip.open(path, "rt", newline="") as fh:
        return {
            int(row["id"]): {c: float(row[c]) for c in COLUMNS[1:]} for row in csv.DictReader(fh)
        }


def latest_snapshot(directory: Path, before: str | None = None) -> Path | None:
    """Most recent snapshot file, optionally strictly before the ISO date ``before``."""
    if not directory.exists():
        return None
    files = sorted(p for p in directory.glob("*.csv.gz") if before is None or p.name[:10] < before)
    return files[-1] if files else None


def diff(previous: dict[int, dict], catalog: dict) -> dict:
    """What changed between a previous snapshot and the current catalogue.

    ``changes`` lists, for objects present in both with a newer element set, the change in mean
    semi-major axis. A single pair of element sets has no noise baseline: these are *changes*,
    not manoeuvre detections.
    """
    cols = catalog["cols"]
    current_ids = set(cols["id"])
    changes = []
    for k, cat in enumerate(cols["id"]):
        old = previous.get(cat)
        if old is None or cols["epoch"][k] <= old["epoch"]:
            continue
        a_new = semi_major_axis_km(cols["n"][k])
        da_m = (a_new - semi_major_axis_km(old["n"])) * 1000.0
        changes.append(
            {
                "id": cat,
                "index": k,
                "da_m": da_m,
                "di_mdeg": (cols["i"][k] - old["i"]) * 1000.0,
                "dt_days": (cols["epoch"][k] - old["epoch"]) / 86400.0,
                "perigee_km": a_new * (1 - cols["e"][k]) - 6378.135,
            }
        )
    return {
        "new": sorted(current_ids - set(previous)),
        "gone": sorted(set(previous) - current_ids),
        "updated": len(changes),
        "unchanged": len(current_ids & set(previous)) - len(changes),
        "changes": changes,
    }


def snapshot_date(path: Path) -> datetime:
    return datetime.strptime(path.name[:10], "%Y-%m-%d").replace(tzinfo=UTC)
