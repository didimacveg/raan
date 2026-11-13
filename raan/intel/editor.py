"""Editor agent: accepted findings → report sections.

Default: deterministic templates (no network, no key). With ``ANTHROPIC_API_KEY`` set, each
section is rewritten by Claude **from the facts only**; the result is kept only if the number
guard finds no figure that is not in the cited facts. Otherwise the template text is used and the
rejection is logged in the report itself.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from raan.intel.core import FactStore, Finding, unsupported_numbers

SECTION_TITLES = {
    "catalog-watch": "Catalogue watch",
    "maneuver-watch": "Manoeuvre watch",
    "conjunction-analyst": "Conjunction research",
}
SYSTEM_PROMPT = (
    "You are the editor of a research lab report on orbital data. Rewrite the draft paragraph "
    "so it reads well for an aerospace engineer: plain, precise, no hype, no first person. "
    "Hard rules: (1) use ONLY the numbers given in FACTS, copied character for character; "
    "(2) do not add any number, date, name or claim that is not in FACTS or the draft; "
    "(3) do not soften or drop any limitation stated in the draft; (4) at most 90 words; "
    "(5) return only the paragraph."
)
DEFAULT_MODEL = "claude-sonnet-5-5"


@dataclass
class Section:
    agent: str
    title: str
    paragraphs: list[dict]  # {title, text, caveat, facts: [ids], writer: "template"|"claude"}


def llm_available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def call_claude(draft: str, facts_block: str) -> str:
    """One Messages API call. Imported lazily so the package works without `anthropic`."""
    import anthropic

    client = anthropic.Anthropic()
    response = client.messages.create(
        model=os.environ.get("RAAN_LLM_MODEL", DEFAULT_MODEL),
        max_tokens=400,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"FACTS\n{facts_block}\n\nDRAFT\n{draft}"}],
    )
    return "".join(block.text for block in response.content if block.type == "text").strip()


class Editor:
    name = "editor"

    def __init__(self, writer=None):
        """``writer(draft, facts_block) -> str`` overrides the language model (used in tests)."""
        self.writer = writer if writer is not None else (call_claude if llm_available() else None)
        self.log: list[str] = []

    def paragraph(self, finding: Finding, store: FactStore) -> dict:
        draft = finding.render(store)
        text, used = draft, "template"
        if self.writer is not None:
            facts = [store[i] for i in finding.fact_ids]
            block = "\n".join(f"- {f.label}: {f.text}" for f in facts)
            try:
                candidate = self.writer(draft, block)
                bad = unsupported_numbers(candidate, facts, extra_allowed={"300"})
                if not candidate:
                    self.log.append(f"{finding.title}: empty model answer, template used")
                elif bad:
                    self.log.append(
                        f"{finding.title}: model text rejected, unsupported numbers {bad}"
                    )
                else:
                    text, used = candidate, "claude"
            except Exception as exc:  # noqa: BLE001 - any API failure falls back to the template
                self.log.append(f"{finding.title}: model call failed ({type(exc).__name__})")
        return {
            "title": finding.title,
            "text": text,
            # The caveat is never delegated to the language model: it is always printed as written.
            "caveat": finding.caveat,
            "facts": finding.fact_ids,
            "writer": used,
        }

    def run(self, findings: list[Finding], store: FactStore) -> list[Section]:
        sections: dict[str, Section] = {}
        for f in sorted(findings, key=lambda f: f.priority):
            sec = sections.setdefault(
                f.agent, Section(f.agent, SECTION_TITLES.get(f.agent, f.agent), [])
            )
            sec.paragraphs.append(self.paragraph(f, store))
        order = list(SECTION_TITLES)
        return sorted(
            sections.values(), key=lambda s: order.index(s.agent) if s.agent in order else 99
        )
