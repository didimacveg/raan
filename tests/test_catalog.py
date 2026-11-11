"""Catalogue pipeline: classification rules, merge logic, polite fetching."""

from datetime import UTC, datetime

import pytest

from raan.catalog import classify
from raan.catalog.build import build_catalog, merge_groups, parse_epoch, valid_gp
from raan.catalog.fetch import fetch_one


def gp(cat, name="X", epoch="2026-11-10T12:00:00.000000", n=15.5, e=0.0005, i=53.0):
    return {
        "OBJECT_NAME": name,
        "OBJECT_ID": "2020-001A",
        "EPOCH": epoch,
        "MEAN_MOTION": str(n),
        "ECCENTRICITY": str(e),
        "INCLINATION": str(i),
        "RA_OF_ASC_NODE": "10",
        "ARG_OF_PERICENTER": "20",
        "MEAN_ANOMALY": "30",
        "NORAD_CAT_ID": str(cat),
        "BSTAR": "1e-4",
        "MEAN_MOTION_DOT": "1e-5",
        "MEAN_MOTION_DDOT": "0",
    }


def test_semi_major_axis_matches_known_orbits():
    # ISS: ~15.5 rev/day → a ≈ 6,795 km; GEO: 1.0027 rev/day → a ≈ 42,164 km
    assert classify.semi_major_axis_km(15.5) == pytest.approx(6795, abs=10)
    assert classify.semi_major_axis_km(1.00273791) == pytest.approx(42164.2, abs=1.0)


@pytest.mark.parametrize(
    ("n", "e", "i", "expected"),
    [
        (15.5, 0.0005, 51.6, "LEO"),  # ISS
        (2.0056, 0.01, 55.0, "MEO"),  # GPS
        (1.0027, 0.0002, 0.05, "GEO"),
        (1.0027, 0.001, 14.0, "GEO"),  # inclined geosynchronous
        (2.0061, 0.72, 63.4, "HEO"),  # Molniya
        (2.3, 0.73, 27.0, "HEO"),  # GTO
        (0.5, 0.01, 10.0, "other"),  # super-synchronous
        (12.4, 0.001, 86.0, "LEO"),  # ~1,400 km
    ],
)
def test_regime(n, e, i, expected):
    assert classify.regime(n, e, i) == expected


def test_object_type_rules():
    assert classify.object_type("R/B", "", False) == "rocket-body"
    assert classify.object_type("DEB", "", False) == "debris"
    assert classify.object_type("PAY", "+", False) == "active"
    assert classify.object_type("PAY", "-", False) == "inactive"
    assert classify.object_type("PAY", "-", True) == "active"  # CelesTrak group wins
    assert classify.object_type(None, None, False) == "unknown"
    assert classify.object_type("UNK", "", True) == "active"


def test_constellation_names():
    assert classify.constellation("STARLINK-1008") == "Starlink"
    assert classify.constellation("ONEWEB-0012") == "OneWeb"
    assert classify.constellation("GPS BIIR-2  (PRN 13)") == "GPS"
    assert classify.constellation("GSAT0201 (GALILEO 5)") == "Galileo"
    assert classify.constellation("ISS (ZARYA)") == ""
    assert classify.constellation("FENGYUN 1C DEB") == ""


def test_parse_epoch_is_utc():
    assert parse_epoch("1970-01-02T00:00:00.000000") == 86400.0
    assert parse_epoch("2026-11-11T00:40:52.252320") == pytest.approx(1794357652.25232)


def test_invalid_rows_are_rejected():
    assert valid_gp(gp(1))
    assert not valid_gp(gp(1, n=0))
    assert not valid_gp(gp(1, e=1.2))
    assert not valid_gp({**gp(1), "EPOCH": "garbage"})


def test_merge_keeps_newest_epoch_and_tracks_active():
    groups = {
        "active": [gp(10, epoch="2026-11-10T00:00:00.000000")],
        "analyst": [gp(10, epoch="2026-11-11T00:00:00.000000"), gp(11), gp(12, n=0)],
    }
    rows, active = merge_groups(groups)
    assert [int(r["NORAD_CAT_ID"]) for r in rows] == [10, 11]
    assert rows[0]["EPOCH"].startswith("2026-11-11") and rows[0]["_group"] == "analyst"
    assert active == {10}


def test_build_catalog_columns_and_meta():
    groups = {
        "active": [gp(25544, "ISS (ZARYA)"), gp(100001, "STARLINK-99999")],
        "fengyun-1c-debris": [gp(30000, "FENGYUN 1C DEB", n=14.2)],
    }
    satcat = {
        25544: {
            "OBJECT_TYPE": "PAY",
            "OPS_STATUS_CODE": "+",
            "OWNER": "ISS",
            "LAUNCH_DATE": "1998-11-20",
            "RCS": "399.05",
            "DECAY_DATE": "",
            "ORBIT_CENTER": "EA",
        },
        30000: {
            "OBJECT_TYPE": "DEB",
            "OPS_STATUS_CODE": "",
            "OWNER": "PRC",
            "LAUNCH_DATE": "1999-05-10",
            "RCS": "",
            "DECAY_DATE": "",
            "ORBIT_CENTER": "EA",
        },
        5: {"OBJECT_TYPE": "PAY", "DECAY_DATE": "1990-01-01", "ORBIT_CENTER": "EA"},
    }
    cat = build_catalog(groups, satcat, datetime(2026, 11, 11, tzinfo=UTC))
    cols, d, meta = cat["cols"], cat["dict"], cat["meta"]
    assert cols["id"] == [25544, 30000, 100001]
    assert all(len(v) == 3 for v in cols.values())
    assert [d["type"][t] for t in cols["type"]] == ["active", "debris", "active"]
    assert d["cons"][cols["cons"][2]] == "Starlink"
    assert d["owner"][cols["owner"][1]] == "China"
    assert cols["launch"] == [1998, 1999, 0]
    assert meta["count"] == 3 and meta["six_digit_ids"] == 1
    assert meta["by_type"] == {"active": 2, "debris": 1}
    assert meta["satcat_on_orbit"]["total"] == 2  # decayed object excluded
    assert meta["epoch_age_days"]["median"] == pytest.approx(0.5)
    assert "not live observations" in meta["source"]


class FakeResponse:
    def __init__(self, status, content=b""):
        self.status_code, self.content, self.text = status, content, content.decode()


class FakeSession:
    def __init__(self, responses):
        self.responses, self.calls = list(responses), 0

    def get(self, url, headers=None, timeout=None):
        self.calls += 1
        return self.responses.pop(0)


def test_fetch_uses_fresh_cache_without_network(tmp_path):
    dest = tmp_path / "gp.csv"
    dest.write_text("cached")
    session = FakeSession([])
    result = fetch_one("g", "http://x", dest, max_age_s=7200, session=session)
    assert result.status == "cached" and session.calls == 0


def test_fetch_downloads_when_stale(tmp_path):
    dest = tmp_path / "gp.csv"
    session = FakeSession([FakeResponse(200, b"A,B\n1,2\n")])
    result = fetch_one("g", "http://x", dest, max_age_s=7200, session=session)
    assert result.status == "downloaded" and dest.read_bytes() == b"A,B\n1,2\n"


def test_fetch_never_retries_http_errors_and_keeps_previous_file(tmp_path):
    """CelesTrak policy: a 403 'not updated' must stop the client, not trigger retries."""
    dest = tmp_path / "gp.csv"
    dest.write_text("previous")
    session = FakeSession([FakeResponse(403, b"GP data has not updated"), FakeResponse(200, b"x")])
    result = fetch_one("g", "http://x", dest, max_age_s=0, session=session)
    assert session.calls == 1
    assert result.status == "not-updated" and result.http_status == 403
    assert dest.read_text() == "previous"


def test_fetch_reports_error_when_no_previous_file(tmp_path):
    session = FakeSession([FakeResponse(404, b"nope")])
    result = fetch_one("g", "http://x", tmp_path / "gp.csv", max_age_s=0, session=session)
    assert result.status == "error" and session.calls == 1
