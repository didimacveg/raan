"""The Python propagator used by the manoeuvre pipeline must reproduce Vallado's vectors too."""

from raan.maneuver.tle import vallado_check


def test_python_sgp4_matches_vallado_reference():
    result = vallado_check()
    assert result["element_sets"] == 33
    assert result["vectors"] > 600 and result["errors"] == 0
    assert result["max_km"] < 1e-6, f"max position error {result['max_km']:.2e} km"
