"""Deterministic classification of catalogued objects.

Every label shown in the web filters comes from the rules in this file, so they can be audited.
"""

from __future__ import annotations

import math
import re

MU_KM3_S2 = 398600.8  # WGS-72, the constant SGP4 itself uses
R_EARTH_KM = 6378.135  # WGS-72 equatorial radius
SIDEREAL_DAY_MIN = 1436.068

OBJECT_TYPES = ("active", "inactive", "rocket-body", "debris", "unknown")
REGIMES = ("LEO", "MEO", "GEO", "HEO", "other")


def semi_major_axis_km(mean_motion_rev_day: float) -> float:
    """Kepler's third law with the SGP4 (WGS-72) gravitational parameter."""
    n = mean_motion_rev_day * 2.0 * math.pi / 86400.0
    return (MU_KM3_S2 / (n * n)) ** (1.0 / 3.0)


def apsides_km(mean_motion_rev_day: float, ecc: float) -> tuple[float, float]:
    """Perigee and apogee altitude above the WGS-72 equatorial radius."""
    a = semi_major_axis_km(mean_motion_rev_day)
    return a * (1.0 - ecc) - R_EARTH_KM, a * (1.0 + ecc) - R_EARTH_KM


def regime(mean_motion_rev_day: float, ecc: float, inc_deg: float) -> str:
    """Orbital regime from mean elements.

    * GEO  — period within 30 min of a sidereal day, e < 0.05 (geosynchronous belt incl. inclined);
    * HEO  — e >= 0.25 (Molniya, GTO, Tundra…), checked before altitude bands;
    * LEO  — apogee altitude < 2,000 km;
    * MEO  — everything between LEO and the GEO belt;
    * other — above GEO or anything else.
    """
    perigee, apogee = apsides_km(mean_motion_rev_day, ecc)
    period_min = 1440.0 / mean_motion_rev_day
    if abs(period_min - SIDEREAL_DAY_MIN) < 30.0 and ecc < 0.05:
        return "GEO"
    if ecc >= 0.25:
        return "HEO"
    if apogee < 2000.0:
        return "LEO"
    if perigee >= 2000.0 - 1e-9 or apogee >= 2000.0:
        return "MEO" if apogee < 35786.0 - 200.0 else "other"
    return "other"


def object_type(satcat_type: str | None, ops_status: str | None, in_active_group: bool) -> str:
    """Map SATCAT ``OBJECT_TYPE`` / ``OPS_STATUS_CODE`` to the five classes used by the filters.

    CelesTrak's ``active`` group is authoritative for "active"; SATCAT status is the fallback.
    """
    t = (satcat_type or "").strip().upper()
    if t == "R/B":
        return "rocket-body"
    if t == "DEB":
        return "debris"
    if t == "PAY":
        if in_active_group or (ops_status or "").strip() in {"+", "P", "B", "S", "X"}:
            return "active"
        return "inactive"
    if in_active_group:
        return "active"
    return "unknown"


# (label, regex on the upper-cased object name). First match wins.
_CONSTELLATIONS: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (label, re.compile(pattern))
    for label, pattern in (
        ("Starlink", r"^STARLINK"),
        ("OneWeb", r"^ONEWEB"),
        ("Kuiper", r"^KUIPER"),
        ("Qianfan", r"^QIANFAN"),
        ("Guowang", r"^HULIANWANG"),
        ("Iridium", r"^IRIDIUM"),
        ("Globalstar", r"^GLOBALSTAR"),
        ("Orbcomm", r"^ORBCOMM"),
        ("GPS", r"^(GPS |NAVSTAR)"),
        ("Galileo", r"^GSAT0\d{3}|GALILEO"),
        ("BeiDou", r"^BEIDOU"),
        ("GLONASS", r"GLONASS"),
        ("Planet", r"^(FLOCK|SKYSAT|PELICAN|TANAGER)"),
        ("Spire", r"^LEMUR"),
        ("ICEYE", r"^ICEYE"),
        ("O3b", r"^O3B"),
        ("Jilin", r"^JILIN"),
        ("Yaogan", r"^YAOGAN"),
        ("Swarm", r"^SPACEBEE"),
        ("Intelsat", r"^INTELSAT"),
        ("SES", r"^(SES|ASTRA)[ -]"),
        ("Eutelsat", r"^(EUTELSAT|HOTBIRD)"),
    )
)


def constellation(name: str) -> str:
    upper = (name or "").upper()
    for label, pattern in _CONSTELLATIONS:
        if pattern.search(upper):
            return label
    return ""


# SATCAT owner codes → readable names (https://celestrak.org/satcat/sources.php). Unlisted codes
# are shown as-is.
OWNERS = {
    "US": "United States",
    "CIS": "Russia / CIS",
    "PRC": "China",
    "UK": "United Kingdom",
    "FR": "France",
    "JPN": "Japan",
    "IND": "India",
    "ESA": "ESA",
    "GER": "Germany",
    "IT": "Italy",
    "SPN": "Spain",
    "CA": "Canada",
    "SKOR": "South Korea",
    "ITSO": "Intelsat (ITSO)",
    "GLOB": "Globalstar",
    "SES": "SES",
    "EUTE": "Eutelsat",
    "EUME": "EUMETSAT",
    "IM": "Inmarsat",
    "O3B": "O3b",
    "ORB": "Orbcomm",
    "ISS": "ISS partners",
    "AUS": "Australia",
    "ARGN": "Argentina",
    "BRAZ": "Brazil",
    "ISRA": "Israel",
    "NETH": "Netherlands",
    "LUXE": "Luxembourg",
    "FIN": "Finland",
    "TURK": "Türkiye",
    "UAE": "UAE",
    "TBD": "To be determined",
}


def owner_name(code: str | None) -> str:
    code = (code or "").strip()
    return OWNERS.get(code, code or "Unknown")
