"""Official Collision Avoidance Challenge metric and companions.

Definitions follow Uriot et al. (arXiv:2008.03069, §4.3):

    L = MSE_HR / F2

* risk values are log10 of collision probability;
* an event is *high-risk* when its final risk r >= -6;
* F2 (beta = 2) is computed over all events on the high-risk label of truth vs prediction;
* MSE_HR is the mean squared error over the truly high-risk events only;
* every prediction below -6 is clipped to -6.001 (optimal under this metric).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

THRESHOLD = -6.0
CLIP_VALUE = -6.001


def clip_predictions(pred: np.ndarray) -> np.ndarray:
    pred = np.asarray(pred, dtype=float)
    return np.where(pred < THRESHOLD, CLIP_VALUE, pred)


@dataclass(frozen=True)
class Score:
    L: float
    mse_hr: float
    f2: float
    precision: float
    recall: float
    tp: int
    fp: int
    fn: int
    tn: int
    n_events: int
    n_high_risk: int

    def as_dict(self) -> dict:
        return asdict(self)


def fbeta(precision: float, recall: float, beta: float = 2.0) -> float:
    denom = beta * beta * precision + recall
    return (1 + beta * beta) * precision * recall / denom if denom > 0 else 0.0


def score(true_risk: np.ndarray, pred_risk: np.ndarray) -> Score:
    """Challenge score. ``L`` is ``inf`` when F2 is zero (no high-risk event recovered)."""
    y = np.asarray(true_risk, dtype=float)
    p = clip_predictions(pred_risk)
    if y.shape != p.shape:
        raise ValueError(f"shape mismatch: {y.shape} vs {p.shape}")
    true_hr = y >= THRESHOLD
    pred_hr = p >= THRESHOLD
    tp = int(np.sum(true_hr & pred_hr))
    fp = int(np.sum(~true_hr & pred_hr))
    fn = int(np.sum(true_hr & ~pred_hr))
    tn = int(np.sum(~true_hr & ~pred_hr))
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f2 = fbeta(precision, recall)
    mse_hr = float(np.mean((y[true_hr] - p[true_hr]) ** 2)) if true_hr.any() else float("nan")
    loss = mse_hr / f2 if f2 > 0 else float("inf")
    return Score(loss, mse_hr, f2, precision, recall, tp, fp, fn, tn, len(y), int(true_hr.sum()))


def bootstrap(
    true_risk: np.ndarray,
    preds: dict[str, np.ndarray],
    reference: str,
    n_boot: int = 2000,
    seed: int = 0,
) -> dict[str, dict]:
    """Event-level bootstrap of L for every model, paired against ``reference``.

    Returns per model: 95 % interval of L, 95 % interval of (L_model − L_reference) and the
    fraction of resamples in which the model beats the reference. With only ~150 high-risk test
    events these intervals are wide — that is the point of reporting them.
    """
    y = np.asarray(true_risk, dtype=float)
    rng = np.random.default_rng(seed)
    n = len(y)
    idx = rng.integers(0, n, size=(n_boot, n))
    losses = {name: np.empty(n_boot) for name in preds}
    for b in range(n_boot):
        rows = idx[b]
        for name, pred in preds.items():
            losses[name][b] = score(y[rows], np.asarray(pred)[rows]).L
    out = {}
    ref = losses[reference]
    for name, values in losses.items():
        finite = np.isfinite(values) & np.isfinite(ref)
        diff = values[finite] - ref[finite]
        out[name] = {
            "L_ci95": [float(np.percentile(values[finite], q)) for q in (2.5, 97.5)],
            "delta_vs_reference_ci95": [float(np.percentile(diff, q)) for q in (2.5, 97.5)],
            "p_better_than_reference": float(np.mean(diff < 0)),
        }
    return out


def reliability(prob: np.ndarray, label: np.ndarray, n_bins: int = 10) -> dict:
    """Reliability diagram data, expected calibration error and Brier score.

    Bins are equal-frequency (quantile) bins because predicted probabilities of a rare event
    pile up near zero.
    """
    prob = np.asarray(prob, dtype=float)
    label = np.asarray(label, dtype=float)
    order = np.argsort(prob, kind="stable")
    bins = []
    ece = 0.0
    for chunk in np.array_split(order, n_bins):
        if len(chunk) == 0:
            continue
        mean_p = float(prob[chunk].mean())
        frac = float(label[chunk].mean())
        bins.append({"mean_predicted": mean_p, "observed": frac, "n": int(len(chunk))})
        ece += abs(mean_p - frac) * len(chunk) / len(prob)
    return {
        "bins": bins,
        "ece": float(ece),
        "brier": float(np.mean((prob - label) ** 2)),
        "base_rate": float(label.mean()),
    }
