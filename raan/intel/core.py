"""Fact store and the number guard.

The rule of the whole module: **agents never compute, they cite.** Every number that reaches a
report is a ``Fact`` produced by the deterministic pipeline, with the file it came from. Text
written by a language model is accepted only if every number in it can be traced to a fact.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field


@dataclass(frozen=True)
class Fact:
    id: str  # e.g. "collision.lrp.L"
    value: float | int | str
    text: str  # the value exactly as it must be printed, e.g. "0.694" or "20,152"
    label: str  # human description
    source: str  # artefact the number was read from
    link: str = ""  # page or URL where it can be checked

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class FactStore:
    facts: dict[str, Fact] = field(default_factory=dict)

    def add(self, id: str, value, label: str, source: str, link: str = "", text: str = "") -> Fact:
        if id in self.facts:
            raise ValueError(f"duplicate fact id {id}")
        fact = Fact(id, value, text or format_value(value), label, source, link)
        self.facts[id] = fact
        return fact

    def __getitem__(self, id: str) -> Fact:
        return self.facts[id]

    def __contains__(self, id: str) -> bool:
        return id in self.facts

    def text(self, id: str) -> str:
        return self.facts[id].text


def format_value(value) -> str:
    if isinstance(value, bool) or isinstance(value, str):
        return str(value)
    if isinstance(value, int):
        return f"{value:,}"
    if abs(value) >= 100:
        return f"{value:,.0f}"
    if abs(value) >= 10:
        return f"{value:.1f}"
    return f"{value:.3f}".rstrip("0").rstrip(".") if abs(value) < 1 else f"{value:.2f}"


@dataclass
class Finding:
    """One thing an analyst agent wants the report to say."""

    agent: str
    title: str
    template: str  # sentence(s) with {fact.id} placeholders — the deterministic wording
    fact_ids: list[str]
    priority: int = 1  # 0 = headline, 1 = normal, 2 = detail
    caveat: str = ""

    def render(self, store: FactStore) -> str:
        """Fill ``{fact.id}`` placeholders. Raises KeyError for an id the finding does not cite."""

        def fill(match: re.Match) -> str:
            fact_id = match.group(1)
            if fact_id not in self.fact_ids:
                raise KeyError(fact_id)
            return store.text(fact_id)

        return _PLACEHOLDER.sub(fill, self.template)


_PLACEHOLDER = re.compile(r"\{([A-Za-z0-9_.]+)\}")


# --------------------------------------------------------------------------- number guard
# A number is not part of an identifier: "Sentinel-3A", "F2" and "10.5281/zenodo" are skipped.
_NUMBER = re.compile(
    r"(?<![\w.])(?<![A-Za-z]-)[-−+]?\d[\d,]*(?:\.\d+)?(?:[eE][-+]?\d+)?%?(?![A-Za-z\d])"
)
# Numbers that are structure, not data: list indices, the 10^-6 threshold written in words, etc.
ALLOWED_LITERALS = {"0", "1", "2", "3", "4", "5", "10", "15", "95", "100"}


def _normalise(token: str) -> str:
    token = token.replace("−", "-").replace(",", "").rstrip("%").lstrip("+")
    try:
        return repr(float(token))
    except ValueError:
        return token


def numbers_in(text: str) -> list[str]:
    return [m.group(0) for m in _NUMBER.finditer(text)]


def unsupported_numbers(
    text: str, facts: list[Fact], extra_allowed: set[str] = frozenset()
) -> list:
    """Numbers in ``text`` that do not appear in the printed form of any cited fact.

    Percentages are accepted when the fact holds the same quantity as a fraction (0.83 → 83%).
    """
    allowed = {_normalise(t) for t in ALLOWED_LITERALS | set(extra_allowed)}
    for fact in facts:
        for token in numbers_in(fact.text) + numbers_in(fact.label):
            allowed.add(_normalise(token))
        if isinstance(fact.value, int | float) and not isinstance(fact.value, bool):
            allowed.add(repr(float(fact.value)))
            if 0 <= abs(fact.value) <= 1:
                for digits in (0, 1):
                    allowed.add(repr(float(round(fact.value * 100, digits))))
    return [tok for tok in numbers_in(text) if _normalise(tok) not in allowed]
