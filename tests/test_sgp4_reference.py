"""The Python propagator used by the manoeuvre pipeline must reproduce Vallado's vectors too."""

from importlib.resources import files

from sgp4.api import WGS72, Satrec


def _cases():
    lines = [
        l
        for l in files("sgp4").joinpath("SGP4-VER.TLE").read_text().splitlines()
        if l.startswith(("1 ", "2 "))
    ]
    return [(lines[k][:69], lines[k + 1][:69]) for k in range(0, len(lines), 2)]


def _reference():
    blocks, rows = [], None
    for line in files("sgp4").joinpath("tcppver.out").read_text().splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1] == "xx":
            rows = []
            blocks.append((int(parts[0]), rows))
        elif len(parts) >= 7:
            rows.append([float(x) for x in parts[:7]])
    return blocks


def test_python_sgp4_matches_vallado_reference():
    cases, blocks = _cases(), _reference()
    assert len(cases) == len(blocks) == 33
    compared, worst = 0, 0.0
    for (l1, l2), (catnr, rows) in zip(cases, blocks, strict=True):
        sat = Satrec.twoline2rv(l1, l2, WGS72)
        assert sat.satnum == catnr
        for tsince, *state in rows:
            err, r, _v = sat.sgp4_tsince(tsince)
            if catnr == 33334:  # deliberately invalid element set; reference line is stale
                continue
            assert err == 0, f"sat {catnr} t={tsince}: error {err}"
            worst = max(worst, max(abs(a - b) for a, b in zip(r, state[:3], strict=True)))
            compared += 1
    assert compared > 600
    assert worst < 1e-6, f"max position error {worst:.2e} km"
