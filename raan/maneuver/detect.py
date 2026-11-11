"""Three manoeuvre detectors sharing one evaluation protocol.

1. ``physics``  — robust thresholds on jumps in semi-major axis, inclination and RTN residuals.
2. ``cusum``    — two-sided CUSUM change detector (Page, 1954) on the same standardised signals;
                  accumulates evidence over several element sets.
3. ``ml``       — gradient-boosted classifier on windowed features (see ``features``).

All three emit one score per interval between consecutive element sets. Scores are turned into
detections and matched against reported manoeuvres by ``evaluate``.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from raan.maneuver.tle import Intervals

WINDOW = 30  # trailing element sets used to estimate each signal's noise
MATCH_LAG_DAYS = 2.0  # a burn may precede the first element set that reflects it by this much
MATCH_SLACK_DAYS = 0.25
CLUSTER_DAYS = 1.5  # reported burns closer than this are one event at ~1 TLE/day
SIGNALS = ("da", "di", "res_t", "res_n", "res_r", "de")


def trailing_robust_z(x: np.ndarray, window: int = WINDOW) -> np.ndarray:
    """z-score of each sample against the median/MAD of the *previous* ``window`` samples.

    Causal on purpose: the score at interval k uses nothing later than k, so every detection
    could have been made on the day its element set was published.
    """
    x = np.asarray(x, dtype=float)
    z = np.zeros(len(x))
    for k in range(len(x)):
        past = x[max(0, k - window) : k]
        past = past[np.isfinite(past)]
        if len(past) < 8 or not np.isfinite(x[k]):
            continue
        med = np.median(past)
        mad = 1.4826 * np.median(np.abs(past - med))
        # floor: a perfectly quiet window must not turn numerical noise into detections
        scale = max(mad, 1e-9 + 0.05 * np.std(past))
        z[k] = (x[k] - med) / scale if scale > 0 else 0.0
    return z


def level_shift(x: np.ndarray, t: np.ndarray, half: int = 3, window: int = WINDOW) -> np.ndarray:
    """Drift-compensated step in ``x`` across each interval j (between sets j and j+1).

    ``median(x[j+1 .. j+half]) − median(x[j-half+1 .. j])`` minus what the secular drift (median
    rate over the previous ``window`` intervals, e.g. drag decay) would have produced anyway.
    Medians of three sets on each side make the statistic blind to a single bad element set — a
    bad set is a spike (out and back), a manoeuvre is a step that stays.

    Needs ``half`` later element sets, i.e. a detection is available ~``half`` sets after the burn.
    """
    x = np.asarray(x, dtype=float)
    n = len(x)
    rate_series = np.diff(x) / np.maximum(np.diff(t), 0.05 * 86400.0)
    out = np.zeros(n - 1)
    for j in range(n - 1):
        if j - half + 1 < 0 or j + half >= n:
            continue
        pre = slice(j - half + 1, j + 1)
        post = slice(j + 1, j + half + 1)
        past = rate_series[max(0, j - window) : max(0, j - half + 1)]
        rate = np.median(past) if len(past) >= 5 else 0.0
        out[j] = (
            np.median(x[post]) - np.median(x[pre]) - rate * (np.median(t[post]) - np.median(t[pre]))
        )
    return out


def trailing_robust_z_gap(s: np.ndarray, window: int = 40, gap: int = 3) -> np.ndarray:
    """Like ``trailing_robust_z`` but skipping the ``gap`` most recent samples, whose level-shift
    windows overlap the current one."""
    s = np.asarray(s, dtype=float)
    z = np.zeros(len(s))
    for j in range(len(s)):
        past = s[max(0, j - window) : max(0, j - gap)]
        if len(past) < 10:
            continue
        med = np.median(past)
        mad = 1.4826 * np.median(np.abs(past - med))
        scale = max(mad, 1e-12 + 0.05 * np.std(past))
        z[j] = (s[j] - med) / scale
    return z


def standardised_signals(iv: Intervals, h=None) -> dict[str, np.ndarray]:
    """Per-interval robust z-scores. Rates (per day) are used where the signal grows with dt.

    When the full history ``h`` is given, the spike-robust level-shift statistics of the mean
    semi-major axis (``shift_a``) and inclination (``shift_i``) are added.
    """
    dt = np.maximum(iv.dt_days, 0.05)
    extra = {}
    if h is not None:
        extra = {
            "shift_a": trailing_robust_z_gap(level_shift(h.a_km * 1000.0, h.t)),
            "shift_i": trailing_robust_z_gap(level_shift(h.inc_deg * 1000.0, h.t)),
        }
    return {
        **extra,
        "da": trailing_robust_z(iv.da_m / dt),
        "di": trailing_robust_z(iv.di_mdeg),
        "res_t": trailing_robust_z(iv.res_t_km / dt**2),
        "res_n": trailing_robust_z(iv.res_n_km / dt),
        "res_r": trailing_robust_z(iv.res_r_km / dt),
        "de": trailing_robust_z(iv.de),
    }


def physics_score(z: dict[str, np.ndarray], variant: str = "a+i") -> np.ndarray:
    """Physics baseline: size of the step in semi-major axis and/or inclination, in robust sigmas.

    Variants (reported as an ablation):
      ``a``        step in semi-major axis only (in-plane burns);
      ``a+i``      also inclination (out-of-plane burns) — the default;
      ``a+i&rtn``  additionally require an RTN residual above the same threshold in the same or
                   the two following intervals (old elements must mis-predict the new position);
      ``jump``     naive single-interval jumps incl. raw RTN residuals (no spike protection).
    """
    a, i = np.abs(z["shift_a"]), np.abs(z["shift_i"])
    if variant == "a":
        return a
    if variant == "a+i":
        return np.maximum(a, i)
    if variant == "a+i&rtn":
        rtn = np.maximum(np.abs(z["res_t"]), np.abs(z["res_n"]))
        near = np.maximum.reduce([rtn, _shift(rtn, 1), _shift(rtn, 2)])
        return np.minimum(np.maximum(a, i), near)
    if variant == "jump":
        return np.max(np.abs(np.vstack([z["da"], z["di"], z["res_t"], z["res_n"]])), axis=0)
    raise ValueError(variant)


def cusum_score(z: dict[str, np.ndarray], drift: float = 1.5, clip: float = 12.0) -> np.ndarray:
    """Two-sided CUSUM statistic per interval (no reset; the caller thresholds it).

    ``S+_k = max(0, S+_{k-1} + z_k − drift)`` and the mirror for negative shifts, run on the
    drift-compensated increments of semi-major axis and inclination; the statistic decays by
    itself once the signal returns to noise, so no explicit reset is needed for offline
    scoring. z is clipped so one wild element set cannot keep the statistic high for weeks.
    """
    out = np.zeros(len(z["da"]))
    for key in ("da", "di"):
        zk = np.clip(z[key], -clip, clip)
        up = down = 0.0
        stat = np.zeros(len(zk))
        for k, value in enumerate(zk):
            up = max(0.0, up + value - drift)
            down = max(0.0, down - value - drift)
            stat[k] = max(up, down)
        out = np.maximum(out, stat)
    return out


def features(iv: Intervals, z: dict[str, np.ndarray], is_geo: bool) -> tuple[np.ndarray, list[str]]:
    """Feature matrix for the classifier: z-scores, magnitudes and their neighbours (±2 sets)."""
    cols: dict[str, np.ndarray] = {}
    for key in SIGNALS:
        cols[f"z_{key}"] = z[key]
        cols[f"absz_{key}"] = np.abs(z[key])
    for key in ("shift_a", "shift_i"):
        cols[f"z_{key}"] = z[key]
        cols[f"absz_{key}"] = np.abs(z[key])
    for key in ("da", "res_t", "res_n", "di", "shift_a", "shift_i"):
        for shift in (-2, -1, 1, 2):
            cols[f"absz_{key}_{'lag' if shift < 0 else 'lead'}{abs(shift)}"] = _shift(
                np.abs(z[key]), shift
            )
    cols["log_abs_da_m"] = np.log10(np.abs(iv.da_m) + 1e-3)
    cols["log_abs_res_t_km"] = np.log10(np.abs(iv.res_t_km) + 1e-4)
    cols["log_abs_res_n_km"] = np.log10(np.abs(iv.res_n_km) + 1e-4)
    cols["log_abs_di_mdeg"] = np.log10(np.abs(iv.di_mdeg) + 1e-4)
    cols["dt_days"] = iv.dt_days
    cols["is_geo"] = np.full(len(iv), float(is_geo))
    names = list(cols)
    return np.column_stack([cols[n] for n in names]), names


def _shift(x: np.ndarray, shift: int) -> np.ndarray:
    """shift<0 → value from earlier intervals (lag); shift>0 → from later intervals (lead)."""
    out = np.zeros_like(x)
    if shift < 0:
        out[-shift:] = x[:shift]
    else:
        out[:-shift] = x[shift:]
    return out


def interval_labels(iv: Intervals, maneuvers: np.ndarray) -> np.ndarray:
    """1 if a reported manoeuvre falls inside the interval (t_start, t_end]."""
    if len(maneuvers) == 0:
        return np.zeros(len(iv), dtype=int)
    idx = np.searchsorted(maneuvers, iv.t_start, side="right")
    has = (idx < len(maneuvers)) & (maneuvers[np.minimum(idx, len(maneuvers) - 1)] <= iv.t_end)
    return has.astype(int)


# --------------------------------------------------------------------------- evaluation
@dataclass
class Detection:
    t_start: float  # start of the first flagged interval
    t_end: float  # end of the last flagged interval (epoch of the set that shows the change)
    k_peak: int  # interval index with the highest score
    score: float
    matched: bool = False


def cluster_truth(maneuvers: np.ndarray, gap_days: float = CLUSTER_DAYS) -> np.ndarray:
    """Merge reported burns closer than ``gap_days``; returns the time of the first of each."""
    if len(maneuvers) == 0:
        return maneuvers
    keep = np.concatenate([[True], np.diff(maneuvers) > gap_days * 86400.0])
    return maneuvers[keep]


def detections_from_scores(iv: Intervals, score: np.ndarray, threshold: float) -> list[Detection]:
    """Consecutive flagged intervals (allowing one unflagged gap) form a single detection."""
    flagged = np.flatnonzero(score >= threshold)
    out: list[Detection] = []
    if len(flagged) == 0:
        return out
    start = prev = flagged[0]
    for k in list(flagged[1:]) + [None]:
        if k is not None and k - prev <= 2:
            prev = k
            continue
        seg = np.arange(start, prev + 1)
        peak = int(seg[np.argmax(score[seg])])
        out.append(Detection(iv.t_start[start], iv.t_end[prev], peak, float(score[peak])))
        if k is not None:
            start = prev = k
    return out


def match(
    detections: list[Detection],
    truth: np.ndarray,
    lag_days: float = MATCH_LAG_DAYS,
    slack_days: float = MATCH_SLACK_DAYS,
) -> tuple[int, np.ndarray]:
    """One-to-one matching. A detection explains a reported burn at time tm when
    ``t_start − lag ≤ tm ≤ t_end + slack``. Returns (true positives, per-truth matched flag).
    """
    found = np.zeros(len(truth), dtype=bool)
    tp = 0
    for det in detections:
        lo = det.t_start - lag_days * 86400.0
        hi = det.t_end + slack_days * 86400.0
        cand = np.flatnonzero((truth >= lo) & (truth <= hi) & ~found)
        if len(cand):
            found[cand[0]] = True
            det.matched = True
            tp += 1
    return tp, found


@dataclass
class Counts:
    tp: int = 0
    fp: int = 0
    fn: int = 0

    def __add__(self, other: Counts) -> Counts:
        return Counts(self.tp + other.tp, self.fp + other.fp, self.fn + other.fn)

    @property
    def precision(self) -> float:
        return self.tp / (self.tp + self.fp) if self.tp + self.fp else 0.0

    @property
    def recall(self) -> float:
        return self.tp / (self.tp + self.fn) if self.tp + self.fn else 0.0

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if p + r else 0.0

    def as_dict(self) -> dict:
        return {
            "tp": self.tp, "fp": self.fp, "fn": self.fn,
            "precision": round(self.precision, 4), "recall": round(self.recall, 4),
            "f1": round(self.f1, 4),
        }  # fmt: skip


def evaluation_mask(iv: Intervals, maneuvers: np.ndarray) -> np.ndarray:
    """Only score inside the labelled period (first reported burn − 5 d … last + 5 d)."""
    if len(maneuvers) == 0:
        return np.zeros(len(iv), dtype=bool)
    return (iv.t_end >= maneuvers[0] - 5 * 86400.0) & (iv.t_start <= maneuvers[-1] + 5 * 86400.0)


def evaluate(
    iv: Intervals,
    score: np.ndarray,
    maneuvers: np.ndarray,
    threshold: float,
    lag_days: float = MATCH_LAG_DAYS,
) -> tuple[Counts, list[Detection], np.ndarray, np.ndarray]:
    """Event-level counts for one satellite at one threshold.

    Returns (counts, detections, clustered truth times, per-truth matched flag).
    """
    mask = evaluation_mask(iv, maneuvers)
    masked = np.where(mask, score, -np.inf)
    dets = detections_from_scores(iv, masked, threshold)
    truth = cluster_truth(maneuvers)
    tp, found = match(dets, truth, lag_days)
    return Counts(tp, len(dets) - tp, len(truth) - tp), dets, truth, found
