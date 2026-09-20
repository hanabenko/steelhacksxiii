"""Turn numbers and symbols into text a speech engine reads correctly."""

from __future__ import annotations

import re

_MPH = "miles per hour"


def number(value: float, places: int = 0) -> str:
    """Format a number for speech, dropping a trailing `.0`."""
    rounded = round(float(value), places)
    if places == 0 or rounded == int(rounded):
        return f"{int(round(rounded)):,}"
    return f"{rounded:,.{places}f}"


def money(value: float) -> str:
    """`100000` -> `100,000 dollars`. Spoken, never `$`."""
    return f"{number(value)} dollars"


def mph(value: float, places: int = 0) -> str:
    return f"{number(value, places)} {_MPH}"


def seconds(value: float, places: int = 0) -> str:
    unit = "second" if round(float(value), places) == 1 else "seconds"
    return f"{number(value, places)} {unit}"


def percent(value: float, places: int = 0) -> str:
    return f"{number(value, places)} percent"


def pluralize(word: str) -> str:
    """Enough English to say `crashes`, `matches` and `boxes` correctly."""
    if word.endswith(("s", "sh", "ch", "x", "z")):
        return f"{word}es"
    if word.endswith("y") and not word.endswith(("ay", "ey", "iy", "oy", "uy")):
        return f"{word[:-1]}ies"
    return f"{word}s"


def count(value: int, singular: str, plural: str | None = None) -> str:
    word = singular if value == 1 else (plural or pluralize(singular))
    return f"{number(value)} {word}"


def join(items: list[str]) -> str:
    """`['a','b','c']` -> `a, b and c`."""
    clean = [item for item in items if item]
    if not clean:
        return ""
    if len(clean) == 1:
        return clean[0]
    return f"{', '.join(clean[:-1])} and {clean[-1]}"


_SYMBOLS = (
    (re.compile(r"\$\s?([\d,]+(?:\.\d+)?)"), r"\1 dollars"),
    (re.compile(r"(\d)\s?%"), r"\1 percent"),
    (re.compile(r"\bmph\b", re.IGNORECASE), _MPH),
    (re.compile(r"\bTTC\b"), "time to collision"),
    (re.compile(r"\bAV\b"), "autonomous vehicle"),
    (re.compile(r"\bAVs\b"), "autonomous vehicles"),
    (re.compile(r"\bVRU\b"), "vulnerable road user"),
    (re.compile(r"\bADT\b"), "average daily traffic"),
    (re.compile(r"\bveh/h\b", re.IGNORECASE), "vehicles per hour"),
    (re.compile(r"\bs/veh\b", re.IGNORECASE), "seconds per vehicle"),
)


def speakable(text: str) -> str:
    """Normalize arbitrary text (e.g. a UI warning string) for speech."""
    result = text
    for pattern, replacement in _SYMBOLS:
        result = pattern.sub(replacement, result)
    return re.sub(r"\s+", " ", result).strip()
