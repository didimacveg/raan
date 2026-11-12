"""Polite CelesTrak downloader.

Implements the CelesTrak usage policy (https://celestrak.org/usage-policy.php):

* GP data is refreshed every 2 hours, so a cached file younger than that is reused;
* any non-200 answer stops the whole run (no retry, no further URLs) — we never hammer;
* an HTTP 403 "GP data has not updated since your last successful download" is expected when the
  same IP already fetched the current update; the caller then keeps the previous snapshot.

Only OMM CSV is requested: the TLE format cannot represent catalogue numbers above 99999 and
CelesTrak stopped issuing new 5-digit numbers on 2026-07-11.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import requests

GP_URL = "https://celestrak.org/NORAD/elements/gp.php"
SATCAT_URL = "https://celestrak.org/pub/satcat.csv"
USER_AGENT = "raan-orbital-lab/0.1 (student research project; daily fetch)"

# Groups that together form the catalogue we can legally obtain in bulk without an account.
# `active` already contains every constellation group, so those are never fetched separately.
GP_GROUPS = (
    "active",
    "analyst",
    "fengyun-1c-debris",
    "cosmos-2251-debris",
    "iridium-33-debris",
)

MIN_REFRESH_S = 2 * 3600
SATCAT_REFRESH_S = 12 * 3600


@dataclass
class FetchResult:
    name: str
    url: str
    path: str  # file name inside the raw directory (never an absolute path: it is published)
    status: str  # "downloaded" | "cached" | "not-updated" | "error" | "skipped"
    http_status: int | None
    fetched_at: str | None  # ISO time of the file we are going to use
    detail: str = ""


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_one(
    name: str,
    url: str,
    dest: Path,
    max_age_s: float,
    session: requests.Session | None = None,
    retries: int = 2,
    now: float | None = None,
) -> FetchResult:
    """Download ``url`` to ``dest`` unless a fresh enough copy exists.

    Network errors (not HTTP errors) are retried ``retries`` times; HTTP errors never are.
    """
    now = time.time() if now is None else now
    if dest.exists() and dest.stat().st_size > 0 and now - dest.stat().st_mtime < max_age_s:
        return FetchResult(name, url, dest.name, "cached", None, _iso(dest.stat().st_mtime))

    session = session or requests.Session()
    last_error = ""
    for attempt in range(retries + 1):
        try:
            resp = session.get(url, headers={"User-Agent": USER_AGENT}, timeout=300)
        except requests.RequestException as exc:  # transport problem: allowed to retry
            last_error = f"{type(exc).__name__}: {exc}"
            time.sleep(5 * (attempt + 1))
            continue
        if resp.status_code == 200 and resp.content:
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_suffix(dest.suffix + ".part")
            tmp.write_bytes(resp.content)
            tmp.replace(dest)
            return FetchResult(name, url, dest.name, "downloaded", 200, _iso(time.time()))
        previous = _iso(dest.stat().st_mtime) if dest.exists() else None
        status = "not-updated" if resp.status_code == 403 and dest.exists() else "error"
        return FetchResult(
            name, url, dest.name, status, resp.status_code, previous, resp.text[:300].strip()
        )
    previous = _iso(dest.stat().st_mtime) if dest.exists() else None
    return FetchResult(name, url, dest.name, "error", None, previous, last_error)


def fetch_all(raw_dir: Path, groups: tuple[str, ...] = GP_GROUPS) -> list[FetchResult]:
    """Fetch every GP group plus the SATCAT into ``raw_dir`` and write a manifest."""
    raw_dir.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    results: list[FetchResult] = []
    jobs = [
        (group, f"{GP_URL}?GROUP={group}&FORMAT=CSV", raw_dir / f"gp_{group}.csv", MIN_REFRESH_S)
        for group in groups
    ]
    jobs.append(("satcat", SATCAT_URL, raw_dir / "satcat.csv", SATCAT_REFRESH_S))
    stopped = False
    for name, url, dest, max_age in jobs:
        if stopped:
            # Usage policy: "immediately stop querying when it receives any non-HTTP 200".
            previous = _iso(dest.stat().st_mtime) if dest.exists() else None
            results.append(
                FetchResult(name, url, dest.name, "skipped", None, previous, "earlier HTTP error")
            )
            continue
        result = fetch_one(name, url, dest, max_age, session)
        results.append(result)
        stopped = result.http_status is not None and result.http_status != 200
        if result.status == "downloaded":
            time.sleep(1.0)
    (raw_dir / "manifest.json").write_text(json.dumps([asdict(r) for r in results], indent=2))
    return results


def load_manifest(raw_dir: Path) -> list[dict]:
    path = raw_dir / "manifest.json"
    return json.loads(path.read_text()) if path.exists() else []
