"""Loading and event-level feature construction for the ESA CDM dataset.

Challenge protocol (Kelvins "Data" page): the model may only use CDMs issued at least
``CUTOFF_DAYS`` = 2 days before the time of closest approach (TCA); the target is the risk in the
last CDM of the event, which in the test set is always issued less than 1 day before TCA.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from raan.paths import RAW

CUTOFF_DAYS = 2.0
FINAL_WINDOW_DAYS = 1.0
CAC_DIR = RAW / "cac"

# Columns of the last usable CDM given to the tabular models. Chosen for physical meaning; the
# remaining ~70 covariance cross-terms were left out to limit over-fitting on 66 positive events.
BASE_FEATURES = [
    "risk", "max_risk_estimate", "max_risk_scaling", "time_to_tca",
    "miss_distance", "relative_speed",
    "relative_position_r", "relative_position_t", "relative_position_n",
    "mahalanobis_distance",
    "t_sigma_r", "t_sigma_t", "t_sigma_n", "c_sigma_r", "c_sigma_t", "c_sigma_n",
    "t_position_covariance_det", "c_position_covariance_det",
    "c_time_lastob_start", "c_time_lastob_end", "c_obs_used", "c_obs_available",
    "c_recommended_od_span", "c_actual_od_span", "c_weighted_rms",
    "t_j2k_sma", "t_j2k_ecc", "t_j2k_inc", "c_j2k_sma", "c_j2k_ecc", "c_j2k_inc",
    "t_span", "c_span", "geocentric_latitude", "azimuth", "elevation",
    "F10", "AP", "mission_id",
]  # fmt: skip
OBJECT_TYPES = ["DEBRIS", "UNKNOWN", "PAYLOAD", "ROCKET BODY", "TBA"]

# Per-CDM inputs of the sequence model (kept small on purpose).
SEQ_FEATURES = [
    "risk", "max_risk_estimate", "time_to_tca", "miss_distance", "relative_speed",
    "mahalanobis_distance", "c_sigma_r", "c_sigma_t", "c_sigma_n", "t_sigma_t",
    "c_obs_used", "c_time_lastob_end",
]  # fmt: skip
LOG_COLUMNS = {
    "miss_distance", "max_risk_scaling", "mahalanobis_distance",
    "t_sigma_r", "t_sigma_t", "t_sigma_n", "c_sigma_r", "c_sigma_t", "c_sigma_n",
    "t_position_covariance_det", "c_position_covariance_det",
}  # fmt: skip


def load(directory: Path = CAC_DIR) -> tuple[pd.DataFrame, pd.DataFrame, pd.Series]:
    """Return (train CDMs, test CDMs, true final risk per test event)."""
    train = pd.read_csv(directory / "train_data.csv")
    test = pd.read_csv(directory / "test_data.csv")
    truth = pd.read_csv(directory / "test_data_private.csv").set_index("event_id")["true_risk"]
    return train, test, truth.sort_index()


def final_risk(cdms: pd.DataFrame, final_window: float = FINAL_WINDOW_DAYS) -> pd.Series:
    """Target per event: risk of the last CDM, kept only if it is within ``final_window`` of TCA.

    This mirrors the filter ESA applied to build the test set.
    """
    last = cdms.sort_values(["event_id", "time_to_tca"]).groupby("event_id").first()
    return last.loc[last["time_to_tca"] < final_window, "risk"]


def _slope(times: np.ndarray, values: np.ndarray) -> float:
    if len(times) < 2 or np.ptp(times) == 0:
        return 0.0
    return float(np.polyfit(times, values, 1)[0])


def event_table(cdms: pd.DataFrame, cutoff: float = CUTOFF_DAYS) -> pd.DataFrame:
    """One row per event, using only CDMs with ``time_to_tca >= cutoff``.

    Features: the latest usable CDM (``BASE_FEATURES``), log-scaled where spans are huge, plus
    summaries of the risk history. ``risk`` of the latest usable CDM is exactly the naive
    "latest risk prediction" baseline.
    """
    usable = cdms[cdms["time_to_tca"] >= cutoff].sort_values(
        ["event_id", "time_to_tca"], ascending=[True, False]
    )
    groups = usable.groupby("event_id", sort=True)
    last = groups.last()  # smallest time_to_tca among usable CDMs
    table = last[BASE_FEATURES].copy()
    for col in LOG_COLUMNS:
        table[col] = np.log10(table[col].clip(lower=1e-30))
    for kind in OBJECT_TYPES:
        table[f"c_type_{kind.lower().replace(' ', '_')}"] = (last["c_object_type"] == kind).astype(
            float
        )

    risk = groups["risk"]
    table["n_cdms"] = groups.size()
    table["risk_mean"] = risk.mean()
    table["risk_std"] = risk.std().fillna(0.0)
    table["risk_max"] = risk.max()
    table["risk_min"] = risk.min()
    table["risk_first"] = risk.first()
    # second-to-last usable CDM (the latest one again when the event has a single CDM)
    table["risk_prev"] = risk.apply(lambda s: float(s.iloc[-2] if len(s) > 1 else s.iloc[-1]))
    table["risk_delta_last"] = table["risk"] - table["risk_prev"]
    table["frac_cdms_high_risk"] = risk.apply(lambda s: float((s >= -6).mean()))
    table["risk_slope"] = groups.apply(
        lambda g: _slope(g["time_to_tca"].to_numpy(), g["risk"].to_numpy()), include_groups=False
    )
    table["tca_span"] = groups["time_to_tca"].max() - groups["time_to_tca"].min()
    table["miss_distance_change"] = np.log10(
        groups["miss_distance"].last().clip(lower=1.0)
    ) - np.log10(groups["miss_distance"].first().clip(lower=1.0))
    return table


def sequences(
    cdms: pd.DataFrame, cutoff: float = CUTOFF_DAYS, max_len: int = 8
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Padded per-event sequences of the last ``max_len`` usable CDMs.

    Returns (event_ids, X[n, max_len, n_features] oldest→newest and right-aligned, mask).
    """
    usable = cdms[cdms["time_to_tca"] >= cutoff].sort_values(
        ["event_id", "time_to_tca"], ascending=[True, False]
    )
    feats = usable[SEQ_FEATURES].copy()
    for col in LOG_COLUMNS & set(SEQ_FEATURES):
        feats[col] = np.log10(feats[col].clip(lower=1e-30))
    values = feats.to_numpy(dtype=np.float32)
    ids, starts = np.unique(usable["event_id"].to_numpy(), return_index=True)
    ends = np.append(starts[1:], len(usable))
    x = np.zeros((len(ids), max_len, len(SEQ_FEATURES)), dtype=np.float32)
    mask = np.zeros((len(ids), max_len), dtype=np.float32)
    for k, (a, b) in enumerate(zip(starts, ends, strict=True)):
        chunk = values[max(a, b - max_len) : b]
        x[k, max_len - len(chunk) :] = chunk
        mask[k, max_len - len(chunk) :] = 1.0
    return ids, x, mask
