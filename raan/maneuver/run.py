"""Manoeuvre detection benchmark.

Compares a physics baseline, a CUSUM change detector and a gradient-boosted classifier on the
15 satellites of the TLE benchmark of Shorten et al. (IDS-reported manoeuvre times), with every
threshold and every model chosen **leave-one-satellite-out**: the numbers reported for a
satellite never used that satellite's labels.

Run: ``python -m raan.maneuver.run`` (about 2 minutes)
Writes ``web/public/data/maneuvers.json`` and ``web/public/data/maneuvers/<satellite>.json``.
"""

from __future__ import annotations

import json
import time
import warnings
from datetime import UTC, datetime

import lightgbm as lgb
import numpy as np
from sklearn.model_selection import GroupKFold

from raan.collision.run import git_sha
from raan.maneuver import detect, tle
from raan.maneuver.detect import Counts
from raan.paths import WEB_DATA, ensure

SEED = 11
METHODS = ("physics", "cusum", "ml")
GRID = {
    "physics": np.array([3, 4, 5, 6, 7, 8, 10, 12, 16, 20, 24, 32, 40], float),
    "cusum": np.array([2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24], float),
    "ml": np.round(np.concatenate([np.arange(0.05, 0.5, 0.05), np.arange(0.5, 0.96, 0.05)]), 2),
}
PHYSICS_VARIANTS = ("a", "a+i", "a+i&rtn", "jump")
SIZE_BINS_M = [0.0, 1.0, 3.0, 10.0, 30.0, 100.0, 1e9]
LGB_PARAMS = dict(
    objective="binary", n_estimators=250, learning_rate=0.05, num_leaves=15,
    min_child_samples=20, subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
    reg_lambda=2.0, random_state=SEED, verbose=-1, n_jobs=4,
)  # fmt: skip


def pooled(names, ivs, scores, hists, threshold, lag=detect.MATCH_LAG_DAYS) -> Counts:
    total = Counts()
    for n in names:
        total += detect.evaluate(ivs[n], scores[n], hists[n].maneuvers, threshold, lag)[0]
    return total


def best_threshold(names, ivs, scores, hists, grid) -> float:
    """Threshold with the highest pooled event-level F1 over ``names``."""
    f1 = [pooled(names, ivs, scores, hists, thr).f1 for thr in grid]
    return float(grid[int(np.argmax(f1))])


def ml_scores(names, hists, ivs, zs) -> tuple[dict[str, np.ndarray], dict[str, float], list]:
    """Leave-one-satellite-out classifier scores and thresholds.

    For held-out satellite s: the model is trained on the other 14; its decision threshold is
    the one maximising event-level F1 on *their* out-of-fold predictions (grouped 3-fold).
    """
    feats, labels, masks = {}, {}, {}
    feature_names: list[str] = []
    for n in names:
        feats[n], feature_names = detect.features(ivs[n], zs[n], hists[n].regime == "GEO")
        labels[n] = detect.interval_labels(ivs[n], detect.cluster_truth(hists[n].maneuvers))
        masks[n] = detect.evaluation_mask(ivs[n], hists[n].maneuvers)

    scores: dict[str, np.ndarray] = {}
    thresholds: dict[str, float] = {}
    gains = np.zeros(len(feature_names))
    for held_out in names:
        others = [n for n in names if n != held_out]
        x = np.vstack([feats[n][masks[n]] for n in others])
        y = np.concatenate([labels[n][masks[n]] for n in others])
        groups = np.concatenate([np.full(masks[n].sum(), k) for k, n in enumerate(others)])
        # inner out-of-fold scores on the training satellites → threshold
        oof = np.zeros(len(y))
        for tr, va in GroupKFold(n_splits=3).split(x, y, groups):
            oof[va] = lgb.LGBMClassifier(**LGB_PARAMS).fit(x[tr], y[tr]).predict_proba(x[va])[:, 1]
        inner = {}
        for k, n in enumerate(others):
            full = np.zeros(len(ivs[n]))
            full[masks[n]] = oof[groups == k]
            inner[n] = full
        thresholds[held_out] = best_threshold(others, ivs, inner, hists, GRID["ml"])
        model = lgb.LGBMClassifier(**LGB_PARAMS).fit(x, y)
        scores[held_out] = model.predict_proba(feats[held_out])[:, 1]
        gain = model.booster_.feature_importance(importance_type="gain")
        gains += gain / gain.sum()
    importance = sorted(zip(feature_names, (gains / len(names)).tolist(), strict=True),
                        key=lambda kv: -kv[1])[:12]  # fmt: skip
    return scores, thresholds, importance


def burn_size_m(h: tle.History, truth: np.ndarray) -> np.ndarray:
    """|step in mean semi-major axis| at each reported burn, from the level-shift statistic."""
    shift = np.abs(detect.level_shift(h.a_km * 1000.0, h.t))
    idx = np.clip(np.searchsorted(h.t, truth, side="left") - 1, 0, len(shift) - 1)
    # the step may register one interval late: take the larger of the two
    return np.maximum(shift[idx], shift[np.minimum(idx + 1, len(shift) - 1)])


def confidence_fn(other_dets: list[detect.Detection]):
    """Empirical confidence: share of detections with a similar-or-higher score, on *other*
    satellites, that matched a reported manoeuvre."""
    if not other_dets:
        return lambda score: None
    scores = np.array([d.score for d in other_dets])
    matched = np.array([d.matched for d in other_dets], float)
    order = np.argsort(scores)
    scores, matched = scores[order], matched[order]

    def conf(score: float) -> float:
        k = np.searchsorted(scores, score, side="left")
        # detections scoring at least as high; fall back to the top 20 when few remain
        k = min(k, max(0, len(scores) - 20))
        return round(float(matched[k:].mean()), 3)

    return conf


def main() -> None:
    warnings.filterwarnings("ignore", message="X does not have valid feature names")
    t0 = time.time()
    names = tle.benchmark_names()
    print(f"loading {len(names)} satellites…")
    hists = {n: tle.load_benchmark(n) for n in names}
    ivs = {n: tle.intervals(h) for n, h in hists.items()}
    zs = {n: detect.standardised_signals(ivs[n], hists[n]) for n in names}
    regimes = {"LEO": [n for n in names if hists[n].regime == "LEO"],
               "GEO": [n for n in names if hists[n].regime == "GEO"]}  # fmt: skip

    scores = {
        "physics": {n: detect.physics_score(zs[n]) for n in names},
        "cusum": {n: detect.cusum_score(zs[n]) for n in names},
    }
    print("classifier, leave-one-satellite-out…")
    scores["ml"], ml_thr, importance = ml_scores(names, hists, ivs, zs)

    # --- leave-one-satellite-out thresholds for the two rule-based detectors ---------------
    thresholds = {"ml": ml_thr, "physics": {}, "cusum": {}}
    for method in ("physics", "cusum"):
        for n in names:
            peers = [m for m in regimes[hists[n].regime] if m != n]
            thresholds[method][n] = best_threshold(peers, ivs, scores[method], hists, GRID[method])

    # --- evaluation -------------------------------------------------------------------------
    per_sat: dict[str, dict] = {n: {} for n in names}
    dets: dict[str, dict[str, list[detect.Detection]]] = {m: {} for m in METHODS}
    found: dict[str, dict[str, np.ndarray]] = {m: {} for m in METHODS}
    truth = {n: detect.cluster_truth(hists[n].maneuvers) for n in names}
    for method in METHODS:
        for n in names:
            counts, d, _truth, f = detect.evaluate(
                ivs[n], scores[method][n], hists[n].maneuvers, thresholds[method][n]
            )
            per_sat[n][method] = {**counts.as_dict(), "threshold": thresholds[method][n]}
            dets[method][n], found[method][n] = d, f

    def group_counts(method: str, group: list[str], lag: float = detect.MATCH_LAG_DAYS) -> dict:
        total = Counts()
        for n in group:
            total += detect.evaluate(
                ivs[n], scores[method][n], hists[n].maneuvers, thresholds[method][n], lag
            )[0]
        return total.as_dict()

    summary = {
        method: {
            "ALL": group_counts(method, names),
            "LEO": group_counts(method, regimes["LEO"]),
            "GEO": group_counts(method, regimes["GEO"]),
        }
        for method in METHODS
    }
    for method in METHODS:
        print(f"  {method:8s}", {g: (v['precision'], v['recall'], v['f1'])
                                 for g, v in summary[method].items()})  # fmt: skip

    lag_sensitivity = {
        method: {str(lag): group_counts(method, names, lag) for lag in (1.0, 2.0, 3.0)}
        for method in METHODS
    }
    ablation = {}
    for variant in PHYSICS_VARIANTS:
        vs = {n: detect.physics_score(zs[n], variant) for n in names}
        total = {g: Counts() for g in ("ALL", "LEO", "GEO")}
        for n in names:
            peers = [m for m in regimes[hists[n].regime] if m != n]
            thr = best_threshold(peers, ivs, vs, hists, GRID["physics"])
            c = detect.evaluate(ivs[n], vs[n], hists[n].maneuvers, thr)[0]
            total["ALL"] += c
            total[hists[n].regime] += c
        ablation[variant] = {g: c.as_dict() for g, c in total.items()}

    # descriptive precision–recall curves (one global threshold, swept; NOT out-of-sample)
    curves = {
        method: {
            g: [
                {
                    "threshold": float(thr),
                    **pooled(group, ivs, scores[method], hists, thr).as_dict(),
                }
                for thr in GRID[method]
            ]
            for g, group in regimes.items()
        }
        for method in METHODS
    }

    # recall as a function of burn size (LEO)
    by_size = []
    sizes = {n: burn_size_m(hists[n], truth[n]) for n in regimes["LEO"]}
    for lo, hi in zip(SIZE_BINS_M[:-1], SIZE_BINS_M[1:], strict=True):
        row = {"lo_m": lo, "hi_m": hi if hi < 1e8 else None, "n": 0}
        for method in METHODS:
            hit = 0
            for n in regimes["LEO"]:
                sel = (sizes[n] >= lo) & (sizes[n] < hi)
                hit += int(found[method][n][sel].sum())
                if method == METHODS[0]:
                    row["n"] += int(sel.sum())
            row[method] = hit
        by_size.append(row)

    # --- per-satellite timelines for the web --------------------------------------------------
    out_dir = ensure(WEB_DATA / "maneuvers")
    satellites = []
    for n in names:
        h, iv = hists[n], ivs[n]
        entry = {
            "name": n, "satcat": h.satcat, "regime": h.regime,
            "element_sets": len(h.t),
            "span": [float(h.t[0]), float(h.t[-1])],
            "reported_maneuvers": int(len(h.maneuvers)),
            "maneuver_events": int(len(truth[n])),
            "median_set_spacing_days": round(float(np.median(iv.dt_days)), 3),
            "metrics": per_sat[n],
        }  # fmt: skip
        satellites.append(entry)
        timeline = {"name": n, "satcat": h.satcat, "regime": h.regime, "detections": {}}
        for method in METHODS:
            others = [d for m in regimes[h.regime] if m != n for d in dets[method][m]]
            conf = confidence_fn(others)
            timeline["detections"][method] = [
                {
                    "t_start": round(d.t_start), "t_end": round(d.t_end),
                    "score": round(d.score, 3), "matched": bool(d.matched),
                    "confidence": conf(d.score),
                    "evidence": {
                        "da_m": round(float(iv.da_m[d.k_peak]), 2),
                        "di_mdeg": round(float(iv.di_mdeg[d.k_peak]), 3),
                        "res_r_km": round(float(iv.res_r_km[d.k_peak]), 3),
                        "res_t_km": round(float(iv.res_t_km[d.k_peak]), 3),
                        "res_n_km": round(float(iv.res_n_km[d.k_peak]), 3),
                        "z_shift_a": round(float(zs[n]["shift_a"][d.k_peak]), 1),
                        "z_shift_i": round(float(zs[n]["shift_i"][d.k_peak]), 1),
                        "dt_days": round(float(iv.dt_days[d.k_peak]), 2),
                    },
                }
                for d in dets[method][n]
            ]  # fmt: skip
        timeline["truth"] = [
            {"t": round(float(tm)), **{m: bool(found[m][n][k]) for m in METHODS}}
            for k, tm in enumerate(truth[n])
        ]
        mask = detect.evaluation_mask(iv, h.maneuvers)
        lo = max(0, int(np.argmax(mask)) - 5)
        hi = min(len(h.t), len(mask) - int(np.argmax(mask[::-1])) + 5)
        a_ref = float(np.median(h.a_km[lo:hi]))
        timeline["series"] = {
            "t": [round(float(v)) for v in h.t[lo:hi]],
            "a_ref_km": round(a_ref, 3),
            "a_m": [round(float(v), 1) for v in (h.a_km[lo:hi] - a_ref) * 1000.0],
            "inc_deg": [round(float(v), 4) for v in h.inc_deg[lo:hi]],
        }
        (out_dir / f"{n}.json").write_text(json.dumps(timeline, separators=(",", ":")))

    result = {
        "meta": {
            "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "code_version": git_sha(),
            "runtime_s": round(time.time() - t0, 1),
            "dataset": {
                "name": "TLE observation benchmark dataset (Shorten et al.)",
                "url": "https://github.com/dpshorten/TLE_observation_benchmark_dataset",
                "commit": tle.BENCHMARK_COMMIT,
                "paper": "arXiv:2212.08662",
                "labels": "manoeuvre times reported through the International DORIS Service "
                "(LEO) and operator records (Fengyun, GEO)",
                "elements": "TLE histories originally from Space-Track.org (18 SDS)",
            },
            "protocol": {
                "validation": "leave-one-satellite-out for thresholds and for the classifier",
                "match_window": f"t_start − {detect.MATCH_LAG_DAYS} d ≤ burn ≤ t_end + "
                f"{detect.MATCH_SLACK_DAYS} d, one-to-one",
                "burn_clustering_days": detect.CLUSTER_DAYS,
                "noise_window_sets": detect.WINDOW,
                "seed": SEED,
            },
            "disclaimer": "Research project, not for operational use.",
        },
        "totals": {
            "satellites": len(names),
            "element_sets": int(sum(len(hists[n].t) for n in names)),
            "reported_maneuvers": int(sum(len(hists[n].maneuvers) for n in names)),
            "maneuver_events": int(sum(len(truth[n]) for n in names)),
        },
        "summary": summary,
        "lag_sensitivity": lag_sensitivity,
        "physics_ablation": ablation,
        "curves": curves,
        "recall_by_size_leo": by_size,
        "importance": [{"feature": f, "gain": round(g, 4)} for f, g in importance],
        "satellites": satellites,
    }
    path = ensure(WEB_DATA) / "maneuvers.json"
    path.write_text(json.dumps(result, separators=(",", ":")))
    print(f"wrote {path} and {len(names)} timelines in {result['meta']['runtime_s']} s")


if __name__ == "__main__":
    main()
