"""TLE histories → per-epoch mean elements and consecutive-set residuals.

Signals (all computed between consecutive element sets k-1 → k of one satellite):

* ``da_m``   change in mean semi-major axis [m] — in-plane burns show up here;
* ``di_mdeg`` change in mean inclination [millidegrees] — out-of-plane burns;
* ``res_r/t/n_km`` RTN residual: element set k-1 propagated with SGP4 to the epoch of set k,
  minus the position given by set k itself, in the radial / along-track / cross-track frame of
  set k. An in-plane burn that changes the period makes the old elements drift along-track.

Mean elements are compared directly (not osculating ones), following Shorten et al. 2023.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import yaml
from sgp4.api import WGS72, Satrec

from raan.paths import RAW

BENCHMARK_DIR = RAW / "shorten" / "processed_files"
BENCHMARK_COMMIT = "5ea648955cc65dddd355f167ba1b51cff6cb8648"
R_EARTH_KM = 6378.135
JD_UNIX_EPOCH = 2440587.5

GEO_SATELLITES = {"Fengyun-2D", "Fengyun-2E", "Fengyun-2F", "Fengyun-2H", "Fengyun-4A"}


@dataclass
class History:
    name: str
    satcat: int
    t: np.ndarray  # epoch of each element set, Unix seconds, strictly increasing
    a_km: np.ndarray  # mean semi-major axis (un-Kozai'd, as SGP4 uses it)
    ecc: np.ndarray
    inc_deg: np.ndarray
    raan_deg: np.ndarray
    bstar: np.ndarray
    records: list  # sgp4 Satrec objects
    maneuvers: np.ndarray  # reported manoeuvre times, Unix seconds (empty if unlabelled)

    @property
    def regime(self) -> str:
        return "GEO" if self.name in GEO_SATELLITES else "LEO"


def parse_tle_text(text: str) -> list[tuple[str, str]]:
    lines = [ln.rstrip() for ln in text.splitlines() if ln.strip()]
    ones = [ln for ln in lines if ln.startswith("1 ")]
    twos = [ln for ln in lines if ln.startswith("2 ")]
    if len(ones) != len(twos):
        raise ValueError(f"unbalanced TLE file: {len(ones)} line-1 vs {len(twos)} line-2")
    return list(zip(ones, twos, strict=True))


def history_from_pairs(
    name: str, pairs: list[tuple[str, str]], maneuvers_unix: np.ndarray | None = None
) -> History:
    recs = [Satrec.twoline2rv(l1, l2, WGS72) for l1, l2 in pairs]
    t = np.array([(s.jdsatepoch - JD_UNIX_EPOCH + s.jdsatepochF) * 86400.0 for s in recs])
    order = np.argsort(t, kind="stable")
    keep = order[np.concatenate([[True], np.diff(t[order]) > 1.0])]  # drop duplicate epochs
    recs = [recs[k] for k in keep]
    return History(
        name=name,
        satcat=int(recs[0].satnum),
        t=t[keep],
        a_km=np.array([s.a * R_EARTH_KM for s in recs]),
        ecc=np.array([s.ecco for s in recs]),
        inc_deg=np.degrees([s.inclo for s in recs]),
        raan_deg=np.degrees([s.nodeo for s in recs]),
        bstar=np.array([s.bstar for s in recs]),
        records=recs,
        maneuvers=np.sort(np.asarray(maneuvers_unix if maneuvers_unix is not None else [], float)),
    )


def load_benchmark(name: str, directory: Path = BENCHMARK_DIR) -> History:
    pairs = parse_tle_text((directory / f"{name}.tle").read_text())
    meta = yaml.safe_load((directory / f"manoeuvres_{name}.yaml").read_text())
    stamps = np.array(
        [np.datetime64(ts, "s").astype("int64") for ts in meta["manoeuvre_timestamps"]], float
    )
    return history_from_pairs(name, pairs, stamps)


def benchmark_names(directory: Path = BENCHMARK_DIR) -> list[str]:
    return sorted(p.stem for p in directory.glob("*.tle"))


def rtn_residual(prev: Satrec, cur: Satrec, dt_minutes: float) -> tuple[float, float, float]:
    """(radial, along-track, cross-track) of [prev propagated to cur's epoch] − [cur], in km."""
    e1, r_pred, _ = prev.sgp4_tsince(dt_minutes)
    e2, r_cur, v_cur = cur.sgp4_tsince(0.0)
    if e1 != 0 or e2 != 0:
        return (np.nan, np.nan, np.nan)
    r_cur, v_cur = np.asarray(r_cur), np.asarray(v_cur)
    radial = r_cur / np.linalg.norm(r_cur)
    normal = np.cross(r_cur, v_cur)
    normal /= np.linalg.norm(normal)
    along = np.cross(normal, radial)
    d = np.asarray(r_pred) - r_cur
    return (float(d @ radial), float(d @ along), float(d @ normal))


@dataclass
class Intervals:
    """Signals for each interval (t[k-1], t[k]], k = 1..n-1."""

    t_start: np.ndarray
    t_end: np.ndarray
    dt_days: np.ndarray
    da_m: np.ndarray
    di_mdeg: np.ndarray
    de: np.ndarray
    res_r_km: np.ndarray
    res_t_km: np.ndarray
    res_n_km: np.ndarray

    def __len__(self) -> int:
        return len(self.t_end)


def intervals(h: History) -> Intervals:
    dt = np.diff(h.t)
    res = np.array(
        [rtn_residual(h.records[k - 1], h.records[k], dt[k - 1] / 60.0) for k in range(1, len(h.t))]
    ).reshape(-1, 3)
    return Intervals(
        t_start=h.t[:-1],
        t_end=h.t[1:],
        dt_days=dt / 86400.0,
        da_m=np.diff(h.a_km) * 1000.0,
        di_mdeg=np.diff(h.inc_deg) * 1000.0,
        de=np.diff(h.ecc),
        res_r_km=res[:, 0],
        res_t_km=res[:, 1],
        res_n_km=res[:, 2],
    )


def vallado_check() -> dict:
    """Compare the ``sgp4`` package with Vallado's reference output (shipped with the package).

    Returns the number of state vectors compared and the largest position difference in km.
    The deliberately invalid element set 33334 must be refused and is not compared.
    """
    from importlib.resources import files

    lines = [
        ln
        for ln in files("sgp4").joinpath("SGP4-VER.TLE").read_text().splitlines()
        if ln.startswith(("1 ", "2 "))
    ]
    cases = [(lines[k][:69], lines[k + 1][:69]) for k in range(0, len(lines), 2)]
    blocks: list[tuple[int, list]] = []
    for line in files("sgp4").joinpath("tcppver.out").read_text().splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1] == "xx":
            blocks.append((int(parts[0]), []))
        elif len(parts) >= 7:
            blocks[-1][1].append([float(x) for x in parts[:7]])
    compared, worst, errors = 0, 0.0, 0
    for (l1, l2), (catnr, rows) in zip(cases, blocks, strict=True):
        sat = Satrec.twoline2rv(l1, l2, WGS72)
        if sat.satnum != catnr:
            raise ValueError(f"verification files out of step at {catnr}")
        for tsince, *state in rows:
            err, r, _v = sat.sgp4_tsince(tsince)
            if catnr == 33334:
                continue
            errors += err != 0
            worst = max(worst, max(abs(a - b) for a, b in zip(r, state[:3], strict=True)))
            compared += 1
    return {"element_sets": len(cases), "vectors": compared, "max_km": worst, "errors": errors}
