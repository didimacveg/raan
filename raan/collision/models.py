"""Baselines and learned models for final-risk prediction.

Every model exposes the same contract: given event features built from CDMs issued >= 2 days
before TCA, return a predicted final log10 risk per event. Model selection (thresholds, value
model) uses out-of-fold predictions on the *training* set only; test labels are never used to fit
or tune anything.
"""

from __future__ import annotations

from dataclasses import dataclass

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

from raan.collision import data, metrics

SEED = 7
N_FOLDS = 5
AUGMENT_CUTOFFS = (2.0, 3.0, 4.0)


# ----------------------------------------------------------------------------- baselines
def constant_risk_prediction(n: int, value: float = -5.0) -> np.ndarray:
    """CRP baseline of the challenge paper."""
    return np.full(n, value)


def latest_risk_prediction(table: pd.DataFrame) -> np.ndarray:
    """LRP baseline: the last risk known two days before TCA, clipped."""
    return metrics.clip_predictions(table["risk"].to_numpy())


# ----------------------------------------------------------------------------- training set
@dataclass
class TrainingSet:
    X: pd.DataFrame  # event features, possibly several cutoffs per event
    y: np.ndarray  # final risk
    groups: np.ndarray  # event_id, for grouped CV
    cutoff: np.ndarray  # cutoff used for each row

    @property
    def protocol_rows(self) -> np.ndarray:
        """Rows built with the challenge cutoff (2 days) — the only ones used for validation."""
        return self.cutoff == data.CUTOFF_DAYS


def build_training_set(
    train_cdms: pd.DataFrame, cutoffs: tuple[float, ...] = AUGMENT_CUTOFFS
) -> TrainingSet:
    """Training rows for events whose final CDM is within one day of TCA (as in the test set).

    Augmentation: the same event is also presented as it looked 3 and 4 days before TCA. This
    multiplies the scarce high-risk examples; rows of one event never straddle CV folds.
    """
    target = data.final_risk(train_cdms)
    frames, ys, groups, cuts = [], [], [], []
    for cutoff in cutoffs:
        table = data.event_table(train_cdms, cutoff)
        table = table.loc[table.index.intersection(target.index)]
        frames.append(table)
        ys.append(target.loc[table.index].to_numpy())
        groups.append(table.index.to_numpy())
        cuts.append(np.full(len(table), cutoff))
    return TrainingSet(
        pd.concat(frames, ignore_index=True),
        np.concatenate(ys),
        np.concatenate(groups),
        np.concatenate(cuts),
    )


def folds(ts: TrainingSet, n_folds: int = N_FOLDS):
    yield from GroupKFold(n_splits=n_folds).split(ts.X, ts.y, ts.groups)


# ----------------------------------------------------------------------------- value model
@dataclass
class ValueModel:
    """Risk value assigned to events the gate calls high-risk.

    ``value = intercept + slope * max(latest_risk, -6)``, least squares on training events that
    truly ended high-risk. Two parameters: with 66 such events anything richer over-fits.
    """

    intercept: float
    slope: float

    @classmethod
    def fit(cls, latest_risk: np.ndarray, final: np.ndarray) -> ValueModel:
        hr = final >= metrics.THRESHOLD
        x = np.maximum(latest_risk[hr], metrics.THRESHOLD)
        if hr.sum() < 3 or np.ptp(x) == 0:
            return cls(float(np.mean(final[hr])) if hr.any() else -5.0, 0.0)
        slope, intercept = np.polyfit(x, final[hr], 1)
        return cls(float(intercept), float(slope))

    def predict(self, latest_risk: np.ndarray) -> np.ndarray:
        value = self.intercept + self.slope * np.maximum(latest_risk, metrics.THRESHOLD)
        return np.clip(value, metrics.THRESHOLD, -1.0)


def gated_prediction(prob: np.ndarray, value: np.ndarray, threshold: float) -> np.ndarray:
    return np.where(prob >= threshold, value, metrics.CLIP_VALUE)


def best_threshold(prob: np.ndarray, value: np.ndarray, final: np.ndarray) -> tuple[float, float]:
    """Gate threshold that minimises the challenge loss on the given (out-of-fold) data."""
    candidates = np.unique(np.quantile(prob, np.linspace(0.5, 0.999, 400)))
    best = (float("inf"), 0.5)
    for tau in candidates:
        loss = metrics.score(final, gated_prediction(prob, value, tau)).L
        if loss < best[0]:
            best = (loss, float(tau))
    return best[1], best[0]


# ----------------------------------------------------------------------------- LightGBM
CLASSIFIER_PARAMS = dict(
    objective="binary", n_estimators=300, learning_rate=0.03, num_leaves=8, max_depth=4,
    min_child_samples=20, subsample=0.8, subsample_freq=1, colsample_bytree=0.7,
    reg_lambda=5.0, scale_pos_weight=10.0, random_state=SEED, verbose=-1, n_jobs=4,
)  # fmt: skip
REGRESSOR_PARAMS = dict(
    objective="regression", n_estimators=400, learning_rate=0.03, num_leaves=8, max_depth=4,
    min_child_samples=20, subsample=0.8, subsample_freq=1, colsample_bytree=0.7,
    reg_lambda=5.0, random_state=SEED, verbose=-1, n_jobs=4,
)  # fmt: skip


def nested_cv_loss(ts: TrainingSet, inner_folds: int = 4) -> float:
    """Cross-validated L of the gate with *every* fitted piece chosen inside the fold.

    ``fit_gbm`` picks the gate threshold on the same out-of-fold predictions it is then scored
    on, and fits the value model on all training events, so its ``cv_loss_gate`` flatters the
    gate. Here, for each outer fold, the threshold and the value model come only from the other
    folds (inner grouped CV); the held-out fold is scored once. This is the fair number to put
    next to the naive forecast.
    """
    y_hr = (ts.y >= metrics.THRESHOLD).astype(int)
    latest = ts.X["risk"].to_numpy()
    proto = ts.protocol_rows
    pred = np.full(len(ts.y), np.nan)
    for train_idx, valid_idx in folds(ts):
        x, y, hr = ts.X.iloc[train_idx], ts.y[train_idx], y_hr[train_idx]
        groups, inner_proto = ts.groups[train_idx], proto[train_idx]
        oof = np.full(len(y), np.nan)
        for a, b in GroupKFold(n_splits=inner_folds).split(x, y, groups):
            clf = lgb.LGBMClassifier(**CLASSIFIER_PARAMS).fit(x.iloc[a], hr[a])
            oof[b] = clf.predict_proba(x.iloc[b])[:, 1]
        inner_latest = latest[train_idx]
        value_model = ValueModel.fit(inner_latest[inner_proto], y[inner_proto])
        threshold, _ = best_threshold(
            oof[inner_proto], value_model.predict(inner_latest[inner_proto]), y[inner_proto]
        )
        clf = lgb.LGBMClassifier(**CLASSIFIER_PARAMS).fit(x, hr)
        prob = clf.predict_proba(ts.X.iloc[valid_idx])[:, 1]
        pred[valid_idx] = gated_prediction(prob, value_model.predict(latest[valid_idx]), threshold)
    return metrics.score(ts.y[proto], pred[proto]).L


@dataclass
class GbmResult:
    oof_prob: np.ndarray  # out-of-fold P(high-risk), protocol rows only
    oof_reg: np.ndarray  # out-of-fold direct regression, protocol rows only
    oof_final: np.ndarray
    oof_latest: np.ndarray
    threshold: float
    cv_loss_gate: float  # threshold tuned on the scored predictions: optimistic for the gate
    cv_loss_gate_nested: float  # threshold and value model chosen inside each fold
    cv_loss_direct: float
    cv_loss_lrp: float
    value_model: ValueModel
    test_prob: np.ndarray
    test_gate: np.ndarray
    test_direct: np.ndarray
    importance: list[tuple[str, float]]


def fit_gbm(ts: TrainingSet, test_table: pd.DataFrame) -> GbmResult:
    """Two LightGBM models: a gate (classifier + 2-parameter value model) and a direct regressor.

    The regression target is clipped at -6.001: under the challenge metric every value below -6
    is equivalent, so the model should not spend capacity telling -12 from -30.
    """
    y_hr = (ts.y >= metrics.THRESHOLD).astype(int)
    y_reg = np.maximum(ts.y, metrics.CLIP_VALUE)
    proto = ts.protocol_rows
    oof_prob = np.full(len(ts.y), np.nan)
    oof_reg = np.full(len(ts.y), np.nan)
    for train_idx, valid_idx in folds(ts):
        clf = lgb.LGBMClassifier(**CLASSIFIER_PARAMS).fit(ts.X.iloc[train_idx], y_hr[train_idx])
        reg = lgb.LGBMRegressor(**REGRESSOR_PARAMS).fit(ts.X.iloc[train_idx], y_reg[train_idx])
        oof_prob[valid_idx] = clf.predict_proba(ts.X.iloc[valid_idx])[:, 1]
        oof_reg[valid_idx] = reg.predict(ts.X.iloc[valid_idx])

    latest = ts.X["risk"].to_numpy()
    value_model = ValueModel.fit(latest[proto], ts.y[proto])
    threshold, cv_gate = best_threshold(
        oof_prob[proto], value_model.predict(latest[proto]), ts.y[proto]
    )
    cv_direct = metrics.score(ts.y[proto], oof_reg[proto]).L
    cv_lrp = metrics.score(ts.y[proto], metrics.clip_predictions(latest[proto])).L

    clf = lgb.LGBMClassifier(**CLASSIFIER_PARAMS).fit(ts.X, y_hr)
    reg = lgb.LGBMRegressor(**REGRESSOR_PARAMS).fit(ts.X, y_reg)
    test_x = test_table[ts.X.columns]
    test_prob = clf.predict_proba(test_x)[:, 1]
    test_gate = gated_prediction(
        test_prob, value_model.predict(test_table["risk"].to_numpy()), threshold
    )
    gain = clf.booster_.feature_importance(importance_type="gain")
    importance = sorted(
        zip(ts.X.columns, (gain / gain.sum()).tolist(), strict=True), key=lambda kv: -kv[1]
    )
    return GbmResult(
        oof_prob[proto], oof_reg[proto], ts.y[proto], latest[proto], threshold, cv_gate,
        nested_cv_loss(ts), cv_direct, cv_lrp, value_model, test_prob, test_gate,
        metrics.clip_predictions(reg.predict(test_x)), importance[:15],
    )  # fmt: skip
