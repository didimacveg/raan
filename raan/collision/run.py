"""Collision Research Lab — full experiment.

Reproduces the challenge baselines, trains the learned models, scores them on the official test
set (never used for fitting or tuning) and writes ``web/public/data/collision.json``.

Run: ``python -m raan.collision.run`` (about 4 minutes on a laptop CPU; ``--no-seq`` skips the GRU)
"""

from __future__ import annotations

import argparse
import json
import subprocess
import time
import warnings
from datetime import UTC, datetime

import numpy as np
import pandas as pd

from raan.collision import data, metrics, models
from raan.paths import ROOT, WEB_DATA, ensure

# Final ranking published in Uriot et al. (arXiv:2008.03069), Table 3.
PUBLISHED = [
    {"team": "sesc", "L": 0.556, "mse_hr": 0.407, "f2": 0.733},
    {"team": "dietmarw", "L": 0.571, "mse_hr": 0.437, "f2": 0.765},
    {"team": "Magpies", "L": 0.585, "mse_hr": 0.441, "f2": 0.753},
    {"team": "Vidente", "L": 0.610, "mse_hr": 0.436, "f2": 0.714},
    {"team": "DeCRA", "L": 0.615, "mse_hr": 0.457, "f2": 0.743},
    {"team": "LRP baseline (paper)", "L": 0.694, "mse_hr": 0.513, "f2": 0.739},
    {"team": "CRP baseline (paper)", "L": 2.5, "mse_hr": None, "f2": None},
]
RISK_BINS = [-30.0, -20.0, -10.0, -8.0, -7.0, -6.0, -5.0, -4.0, 0.0]


def git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True
        ).strip()
    except Exception:  # noqa: BLE001 - provenance is best effort
        return "unknown"


def r(x: float, digits: int = 4) -> float | None:
    return None if x is None or not np.isfinite(x) else round(float(x), digits)


def dataset_stats(train: pd.DataFrame, test: pd.DataFrame, truth: pd.Series) -> dict:
    last_all = train.sort_values(["event_id", "time_to_tca"]).groupby("event_id").first()
    target = data.final_risk(train)
    usable = train[train["time_to_tca"] >= data.CUTOFF_DAYS]["event_id"].unique()
    protocol = target.loc[target.index.intersection(usable)]
    return {
        "train": {
            "cdms": int(len(train)),
            "events": int(train["event_id"].nunique()),
            "events_high_risk": int((last_all["risk"] >= -6).sum()),
            "events_protocol": int(len(protocol)),
            "events_protocol_high_risk": int((protocol >= -6).sum()),
            "prevalence_protocol": r(float((protocol >= -6).mean()), 5),
            "missions": int(train["mission_id"].nunique()),
        },
        "test": {
            "cdms": int(len(test)),
            "events": int(test["event_id"].nunique()),
            "events_high_risk": int((truth >= -6).sum()),
            "prevalence": r(float((truth >= -6).mean()), 5),
            "missions": int(test["mission_id"].nunique()),
            "min_time_to_tca_of_inputs": r(float(test["time_to_tca"].min()), 4),
        },
    }


def transition_table(latest: np.ndarray, final: np.ndarray) -> list[dict]:
    """P(final risk is high | latest known risk falls in a bin)."""
    rows = []
    for lo, hi in zip(RISK_BINS[:-1], RISK_BINS[1:], strict=True):
        sel = (latest >= lo) & (latest < hi) if hi < 0 else (latest >= lo)
        n = int(sel.sum())
        rows.append(
            {
                "lo": lo,
                "hi": hi,
                "n": n,
                "n_high_final": int((final[sel] >= -6).sum()),
                "p_high_final": r(float((final[sel] >= -6).mean()), 4) if n else None,
            }
        )
    return rows


def false_negative_profile(table: pd.DataFrame, truth: np.ndarray, pred: np.ndarray) -> dict:
    """Who are the high-risk events the model called safe?"""
    hr = truth >= -6
    fn = hr & (metrics.clip_predictions(pred) < -6)
    latest = table["risk"].to_numpy()
    return {
        "n": int(fn.sum()),
        "latest_risk_below_minus_10": int((latest[fn] < -10).sum()),
        "latest_risk_floor_minus_30": int((latest[fn] <= -29.99).sum()),
        "latest_risk_between_minus_7_and_minus_6": int(
            ((latest[fn] >= -7) & (latest[fn] < -6)).sum()
        ),
        "median_latest_risk": r(float(np.median(latest[fn])), 3) if fn.any() else None,
        "median_true_risk": r(float(np.median(truth[fn])), 3) if fn.any() else None,
        "median_n_cdms": r(float(np.median(table["n_cdms"].to_numpy()[fn])), 1)
        if fn.any()
        else None,
        "median_days_to_tca_of_last_input": (
            r(float(np.median(table["time_to_tca"].to_numpy()[fn])), 2) if fn.any() else None
        ),
        "squared_error_share_of_mse_hr": (
            r(float(((truth[fn] - metrics.CLIP_VALUE) ** 2).sum() / hr.sum()), 4)
            if fn.any()
            else 0.0
        ),
    }


def example_trajectories(train: pd.DataFrame) -> list[dict]:
    """Full risk histories of a few *training* events (the test set hides the last two days)."""
    target = data.final_risk(train)
    table = data.event_table(train)
    table = table.loc[table.index.intersection(target.index)]
    final = target.loc[table.index]
    latest = table["risk"]
    picks: list[tuple[str, int]] = []
    rules = {
        "late surge (missed by the naive forecast)": (latest < -7) & (final >= -5.5),
        "late collapse (false alarm for the naive forecast)": (latest >= -5) & (final < -10),
        "stable high risk": (latest >= -5) & (final >= -5) & (table["n_cdms"] >= 8),
        "stable low risk": (latest < -8) & (final < -8) & (table["n_cdms"] >= 10),
    }
    for label, sel in rules.items():
        ids = sorted(table.index[sel.to_numpy()])
        picks += [(label, int(i)) for i in ids[:2]]
    out = []
    for label, event_id in picks:
        ev = train[train["event_id"] == event_id].sort_values("time_to_tca", ascending=False)
        out.append(
            {
                "event_id": event_id,
                "label": label,
                "time_to_tca": [r(v, 3) for v in ev["time_to_tca"]],
                "risk": [r(v, 3) for v in ev["risk"]],
            }
        )
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-seq", action="store_true", help="skip the GRU (no PyTorch needed)")
    parser.add_argument("--boot", type=int, default=2000)
    args = parser.parse_args()
    warnings.filterwarnings("ignore", message="X does not have valid feature names")
    t0 = time.time()

    train, test, truth = data.load()
    y = truth.to_numpy()
    table = data.event_table(test)
    assert (table.index == truth.index).all()

    print("building training set…")
    ts = models.build_training_set(train)
    print("LightGBM…")
    gbm = models.fit_gbm(ts, table)

    preds: dict[str, np.ndarray] = {
        "crp": models.constant_risk_prediction(len(y)),
        "lrp": models.latest_risk_prediction(table),
        "gbm_gate": gbm.test_gate,
        "gbm_direct": gbm.test_direct,
    }
    info = {
        "crp": {"name": "Constant risk (−5)", "kind": "baseline", "cv_L": None},
        "lrp": {"name": "Latest risk (naive forecast)", "kind": "baseline",
                "cv_L": r(gbm.cv_loss_lrp)},
        "gbm_gate": {"name": "LightGBM gate + value", "kind": "gradient boosting",
                     "cv_L": r(gbm.cv_loss_gate), "cv_L_nested": r(gbm.cv_loss_gate_nested),
                     "threshold": r(gbm.threshold, 5)},
        "gbm_direct": {"name": "LightGBM direct regression", "kind": "gradient boosting",
                       "cv_L": r(gbm.cv_loss_direct)},
    }  # fmt: skip
    seq_result = None
    if not args.no_seq:
        from raan.collision import seq

        print("GRU (3 seeds × 5 folds)…")
        seq_result = seq.fit_gru(train, test)
        preds["gru"] = seq_result.test_pred
        info["gru"] = {
            "name": "GRU sequence model", "kind": "sequential",
            "cv_L": r(seq_result.cv_loss), "threshold": r(seq_result.threshold, 5),
            "parameters": seq_result.n_parameters,
        }  # fmt: skip

    print("scoring + bootstrap…")
    boot = metrics.bootstrap(y, preds, reference="lrp", n_boot=args.boot, seed=0)
    results = []
    for key, pred in preds.items():
        s = metrics.score(y, pred)
        results.append(
            {
                "key": key,
                **info[key],
                **{k: (r(v) if isinstance(v, float) else v) for k, v in s.as_dict().items()},
                **boot[key],
            }
        )
        print(f"  {key:11s} L={s.L:.4f} MSE_HR={s.mse_hr:.4f} F2={s.f2:.4f} FN={s.fn} FP={s.fp}")

    lrp_cv, gate_cv = info["lrp"]["cv_L"], info["gbm_gate"]["cv_L"]
    lrp_test = next(x for x in results if x["key"] == "lrp")
    gate_test = next(x for x in results if x["key"] == "gbm_gate")
    # Diagnostic only: the best gate threshold if one were allowed to tune on the test labels.
    oracle_tau, oracle_loss = models.best_threshold(
        gbm.test_prob, gbm.value_model.predict(table["risk"].to_numpy()), y
    )

    proto = ts.protocol_rows
    out = {
        "meta": {
            "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "code_version": git_sha(),
            "runtime_s": None,
            "dataset": {
                "name": "Collision Avoidance Challenge dataset (ESA)",
                "doi": "10.5281/zenodo.4463683",
                "license": "CC BY 4.0",
                "md5": "d19dc8875229f2f6893253c38adddc87",
                "citation": "Uriot et al., Spacecraft Collision Avoidance Challenge: design and "
                "results of a machine learning competition, arXiv:2008.03069",
            },
            "protocol": {
                "cutoff_days": data.CUTOFF_DAYS,
                "final_window_days": data.FINAL_WINDOW_DAYS,
                "high_risk_threshold_log10": metrics.THRESHOLD,
                "clip_value": metrics.CLIP_VALUE,
                "augment_cutoffs": list(models.AUGMENT_CUTOFFS),
                "cv_folds": models.N_FOLDS,
                "seed": models.SEED,
                "bootstrap_resamples": args.boot,
            },
            "disclaimer": "Research project, not for operational use.",
        },
        "dataset": dataset_stats(train, test, truth),
        "results": results,
        "published": PUBLISHED,
        "selection": {
            "rule": "choose the model with the lowest cross-validated L on the training set",
            "cv_L_lrp": lrp_cv,
            "cv_L_gbm_gate": gate_cv,
            "cv_L_gbm_gate_nested": r(gbm.cv_loss_gate_nested),
            "cv_note": "cv_L_gbm_gate tunes the threshold on the predictions it scores (optimistic "
            "for the gate); the nested value chooses threshold and value model inside each fold",
            "selected_by_rule": "lrp" if lrp_cv <= gate_cv else "gbm_gate",
            "test_L_lrp": lrp_test["L"],
            "test_L_gbm_gate": gate_test["L"],
            "oracle_threshold_diagnostic": {"threshold": r(oracle_tau, 5), "L": r(oracle_loss)},
        },
        "value_model": {
            "intercept": r(gbm.value_model.intercept),
            "slope": r(gbm.value_model.slope),
        },
        "transition": {
            "train_protocol": transition_table(ts.X["risk"].to_numpy()[proto], ts.y[proto]),
            "test": transition_table(table["risk"].to_numpy(), y),
        },
        "calibration": {
            "gbm_train_oof": metrics.reliability(gbm.oof_prob, gbm.oof_final >= -6),
            "gbm_test": metrics.reliability(gbm.test_prob, y >= -6),
            **(
                {"gru_test": metrics.reliability(seq_result.test_prob, y >= -6)}
                if seq_result is not None
                else {}
            ),
        },
        "false_negatives": {key: false_negative_profile(table, y, preds[key]) for key in preds},
        "importance": [{"feature": f, "gain": r(g)} for f, g in gbm.importance],
        "examples": example_trajectories(train),
        # per-event arrays so the page can recompute every metric interactively
        "events": {
            "event_id": table.index.astype(int).tolist(),
            "true_risk": [r(v, 3) for v in y],
            "latest_risk": [r(v, 3) for v in table["risk"]],
            "n_cdms": table["n_cdms"].astype(int).tolist(),
            "mission_id": table["mission_id"].astype(int).tolist(),
            "gbm_prob": [r(v, 5) for v in gbm.test_prob],
            "gbm_value": [r(v, 3) for v in gbm.value_model.predict(table["risk"].to_numpy())],
            "gbm_direct": [r(v, 3) for v in gbm.test_direct],
            **(
                {
                    "gru_prob": [r(v, 5) for v in seq_result.test_prob],
                    "gru_pred": [r(v, 3) for v in seq_result.test_pred],
                }
                if seq_result is not None
                else {}
            ),
        },
    }
    out["meta"]["runtime_s"] = round(time.time() - t0, 1)
    path = ensure(WEB_DATA) / "collision.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {path} ({path.stat().st_size / 1e3:.0f} kB) in {out['meta']['runtime_s']} s")


if __name__ == "__main__":
    main()
