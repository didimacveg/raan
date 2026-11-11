"""Orbital Intelligence — orchestrator.

    analysts (CatalogWatch, ManeuverWatch, ConjunctionAnalyst)
        → Reviewer (fact and number checks)
        → Editor (templates, or Claude behind the number guard)
        → web/public/data/report.json + reports/<date>.md

Run: ``python -m raan.intel.run [--archive DIR]``. Works offline and without any API key.
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from raan import brand
from raan.catalog import archive
from raan.intel.agents import (
    CatalogWatch,
    ConjunctionAnalyst,
    Context,
    ManeuverWatch,
    Reviewer,
    load_json,
)
from raan.intel.editor import Editor, Section
from raan.paths import DATA, REPORTS, WEB_DATA, ensure

ANALYSTS = (CatalogWatch, ManeuverWatch, ConjunctionAnalyst)


def build_context(web_data: Path, archive_dir: Path | None) -> Context:
    ctx = Context(
        catalog=load_json(web_data / "catalog.json"),
        collision=load_json(web_data / "collision.json"),
        maneuvers=load_json(web_data / "maneuvers.json"),
    )
    if ctx.catalog is not None and archive_dir is not None:
        today = ctx.catalog["meta"]["generated_at"][:10]
        previous = archive.latest_snapshot(archive_dir, before=today)
        if previous is not None:
            ctx.diff = archive.diff(archive.load_snapshot(previous), ctx.catalog)
            ctx.previous_date = previous.name[:10]
    return ctx


def run(ctx: Context, editor: Editor | None = None, now: datetime | None = None) -> dict:
    findings = [f for analyst in ANALYSTS for f in analyst().run(ctx)]
    review = Reviewer().run(findings, ctx.store)
    editor = editor or Editor()
    sections = editor.run(review.accepted, ctx.store)
    cited = sorted({i for s in sections for p in s.paragraphs for i in p["facts"]})
    now = now or datetime.now(UTC)
    return {
        "meta": {
            "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "title": f"{brand.NAME} orbital intelligence report",
            "writer": "claude"
            if any(p["writer"] == "claude" for s in sections for p in s.paragraphs)
            else "template",
            "disclaimer": brand.DISCLAIMER,
            "agents": [a.name for a in ANALYSTS] + [Reviewer.name, Editor.name],
            "findings_proposed": len(findings),
            "findings_accepted": len(review.accepted),
            "findings_rejected": [
                {"title": f.title, "agent": f.agent, "reason": why} for f, why in review.rejected
            ],
            "editor_log": editor.log,
        },
        "sections": [
            {"agent": s.agent, "title": s.title, "paragraphs": s.paragraphs} for s in sections
        ],
        "facts": {i: ctx.store[i].as_dict() for i in cited},
    }


def to_markdown(report: dict) -> str:
    meta = report["meta"]
    lines = [
        f"# {meta['title']}",
        "",
        f"_{meta['generated_at'].replace('T', ' ').replace('Z', ' UTC')} · written by: "
        f"{meta['writer']} · {meta['disclaimer']}_",
        "",
    ]
    for section in report["sections"]:
        lines += [f"## {section['title']}", ""]
        for p in section["paragraphs"]:
            lines += [f"**{p['title']}.** {p['text']}", ""]
            if p["caveat"]:
                lines += [f"> Caveat: {p['caveat']}", ""]
    lines += ["## Sources", "", "| Fact | Value | Source |", "|---|---|---|"]
    for fact in report["facts"].values():
        src = f"[{fact['source']}]({fact['link']})" if fact["link"] else fact["source"]
        lines.append(f"| {fact['label']} | {fact['text']} | {src} |")
    if meta["findings_rejected"] or meta["editor_log"]:
        lines += ["", "## Review log", ""]
        lines += [f"- rejected: {r['title']} — {r['reason']}" for r in meta["findings_rejected"]]
        lines += [f"- {entry}" for entry in meta["editor_log"]]
    return "\n".join(lines) + "\n"


def sections_from(report: dict) -> list[Section]:
    return [Section(s["agent"], s["title"], s["paragraphs"]) for s in report["sections"]]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=DATA / "archive")
    parser.add_argument("--web-data", type=Path, default=WEB_DATA)
    args = parser.parse_args()
    report = run(build_context(args.web_data, args.archive))
    (ensure(args.web_data) / "report.json").write_text(json.dumps(report, indent=1))
    day = report["meta"]["generated_at"][:10]
    md = to_markdown(report)
    (ensure(REPORTS) / f"{day}.md").write_text(md)
    (REPORTS / "latest.md").write_text(md)
    m = report["meta"]
    print(
        f"report: {m['findings_accepted']}/{m['findings_proposed']} findings accepted, "
        f"writer={m['writer']}, {len(report['facts'])} facts → reports/{day}.md"
    )
    for r in m["findings_rejected"]:
        print(f"  rejected: {r['title']}: {r['reason']}")


if __name__ == "__main__":
    main()
