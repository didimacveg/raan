"""Agent logic: facts are cited not invented, the reviewer and the number guard hold the line."""

from datetime import UTC, datetime

from raan.catalog import archive
from raan.catalog.build import build_catalog
from raan.intel import run as intel_run
from raan.intel.agents import CatalogWatch, Context, ManeuverWatch, Reviewer
from raan.intel.core import FactStore, Finding, format_value, numbers_in, unsupported_numbers
from raan.intel.editor import Editor
from tests.test_catalog import gp


def small_catalog(extra=(), n_iss=15.5):
    groups = {
        "active": [gp(25544, "ISS (ZARYA)", n=n_iss), gp(44713, "STARLINK-1007"), *extra],
        "fengyun-1c-debris": [gp(30000, "FENGYUN 1C DEB", n=14.2,
                                 epoch="2026-11-01T00:00:00.000000")],
    }  # fmt: skip
    satcat = {
        25544: {"OBJECT_TYPE": "PAY", "OPS_STATUS_CODE": "+", "OWNER": "ISS", "DECAY_DATE": "",
                "ORBIT_CENTER": "EA"},
        30000: {"OBJECT_TYPE": "DEB", "OWNER": "PRC", "DECAY_DATE": "", "ORBIT_CENTER": "EA"},
    }  # fmt: skip
    return build_catalog(groups, satcat, datetime(2026, 11, 11, tzinfo=UTC))


def test_format_value():
    assert format_value(20152) == "20,152"
    assert format_value(0.694) == "0.694"
    assert format_value(2.5041) == "2.50"
    assert format_value(16.04) == "16.0"
    assert format_value("Starlink") == "Starlink"


def test_number_extraction():
    assert numbers_in("L = 0.694, 2,167 events, −6.001 and 86% in 2026") == [
        "0.694", "2,167", "−6.001", "86%", "2026",
    ]  # fmt: skip
    assert numbers_in("Sentinel-3A and F2 score") == []  # identifiers are not numbers


def test_number_guard_accepts_cited_values_and_rejects_everything_else():
    store = FactStore()
    a = store.add("x.count", 20152, "Objects", "catalog.json")
    b = store.add("x.share", 0.8269, "Precision", "maneuvers.json", text="0.83")
    assert unsupported_numbers("There are 20,152 objects; precision 0.83 (83%).", [a, b]) == []
    assert unsupported_numbers("There are 20152 objects.", [a]) == []
    assert unsupported_numbers("There are 20,153 objects.", [a]) == ["20,153"]
    assert unsupported_numbers("Precision improved to 0.91.", [a, b]) == ["0.91"]
    assert unsupported_numbers("About 21,000 objects, up 4.2%.", [a]) == ["21,000", "4.2%"]


def test_finding_cannot_use_a_fact_it_does_not_cite():
    store = FactStore()
    store.add("a.n", 5, "n", "src")
    store.add("a.m", 7, "m", "src")
    review = Reviewer().run(
        [
            Finding("t", "ok", "n is {a.n}.", ["a.n"]),
            Finding("t", "uncited", "n is {a.n}, m is {a.m}.", ["a.n"]),
            Finding("t", "missing", "k is {a.k}.", ["a.k"]),
            Finding("t", "hard-coded", "n is {a.n}, which is 31% more.", ["a.n"]),
        ],
        store,
    )
    assert [f.title for f in review.accepted] == ["ok"]
    reasons = {f.title: why for f, why in review.rejected}
    assert "uncited fact" in reasons["uncited"]
    assert "missing facts" in reasons["missing"]
    assert "unsupported numbers: ['31%']" in reasons["hard-coded"]


def test_catalog_watch_facts_match_the_artefact():
    ctx = Context(catalog=small_catalog())
    findings = CatalogWatch().run(ctx)
    assert ctx.store["catalog.count"].value == 3
    assert ctx.store["catalog.stale"].value == 1  # the debris element set is 10 days old
    assert ctx.store["catalog.top_constellation"].value == "Starlink"
    review = Reviewer().run(findings, ctx.store)
    assert not review.rejected and len(review.accepted) == 3


def test_snapshot_roundtrip_and_diff(tmp_path):
    old = small_catalog()
    old["meta"]["generated_at"] = "2026-11-10T00:00:00Z"
    path = archive.write_snapshot(old, tmp_path)
    assert path.name == "2026-11-10.csv.gz"
    assert path.read_bytes() == archive.write_snapshot(old, tmp_path).read_bytes()  # reproducible
    snap = archive.load_snapshot(path)
    assert set(snap) == {25544, 30000, 44713} and snap[25544]["n"] == 15.5

    # next day: the ISS has a newer element set 2 km higher, a new object appears, one vanishes
    new = small_catalog(extra=[gp(70001, "NEWSAT")], n_iss=15.4932)
    k = new["cols"]["id"].index(25544)
    new["cols"]["epoch"][k] += 86400.0
    j = new["cols"]["id"].index(30000)
    for col in new["cols"].values():
        del col[j]
    d = archive.diff(snap, new)
    assert d["new"] == [70001] and d["gone"] == [30000] and d["updated"] == 1
    change = d["changes"][0]
    assert change["id"] == 25544 and 1900 < change["da_m"] < 2100 and change["dt_days"] == 1.0
    assert archive.latest_snapshot(tmp_path, before="2026-11-10") is None
    assert archive.latest_snapshot(tmp_path, before="2026-11-11") == path

    ctx = Context(catalog=new, diff=d, previous_date="2026-11-10")
    findings = CatalogWatch().run(ctx) + ManeuverWatch().run(ctx)
    review = Reviewer().run(findings, ctx.store)
    assert not review.rejected
    text = " ".join(f.render(ctx.store) for f in review.accepted)
    assert "1 objects appeared, 1 are no longer listed" in text
    assert "ISS (ZARYA) (+1.9" in text or "ISS (ZARYA) (+2.0" in text
    caveats = " ".join(f.caveat for f in review.accepted)
    assert "not validated manoeuvre detections" in caveats


def test_editor_template_mode_needs_no_network():
    ctx = Context(catalog=small_catalog())
    report = intel_run.run(ctx, editor=Editor(writer=None), now=datetime(2026, 11, 11, tzinfo=UTC))
    assert report["meta"]["writer"] == "template"
    md = intel_run.to_markdown(report)
    assert "Research project, not for operational use" in md and "## Sources" in md
    for section in report["sections"]:
        for p in section["paragraphs"]:
            assert all(fid in report["facts"] for fid in p["facts"])


def test_editor_rejects_model_text_with_invented_numbers():
    ctx = Context(catalog=small_catalog())

    def hallucinating(draft, facts_block):
        return draft.replace("3 objects", "3 objects (a 12.5% increase)")

    editor = Editor(writer=hallucinating)
    report = intel_run.run(ctx, editor=editor)
    headline = report["sections"][0]["paragraphs"][0]
    assert headline["writer"] == "template" and "12.5%" not in headline["text"]
    assert any("unsupported numbers ['12.5%']" in entry for entry in editor.log)


def test_editor_accepts_faithful_rewrites_and_survives_api_errors():
    ctx = Context(catalog=small_catalog())
    calls = []

    def faithful(draft, facts_block):
        calls.append(facts_block)
        if "Starlink" in draft:
            raise TimeoutError("api down")
        return "Rewritten: " + draft

    editor = Editor(writer=faithful)
    report = intel_run.run(ctx, editor=editor)
    writers = [p["writer"] for s in report["sections"] for p in s["paragraphs"]]
    assert writers.count("claude") == 2 and writers.count("template") == 1
    assert report["meta"]["writer"] == "claude"
    assert any("model call failed (TimeoutError)" in entry for entry in editor.log)
    assert all("- " in block for block in calls)  # the model only ever sees the cited facts
