"""SHAP post-processing: turn a contributions map into top +/- driver lists."""
from __future__ import annotations


def top_contributions(contribs: dict[str, float], k: int = 5):
    """Return (top_positive, top_negative) as lists of (feature, value) tuples.

    Positive = pushed P(up) higher; negative = pushed it lower. Sorted by
    magnitude so the narrator can say "driven mainly by X, Y".
    """
    items = sorted(contribs.items(), key=lambda kv: kv[1], reverse=True)
    positive = [(n, v) for n, v in items if v > 0][:k]
    negative = [(n, v) for n, v in reversed(items) if v < 0][:k]
    return positive, negative
