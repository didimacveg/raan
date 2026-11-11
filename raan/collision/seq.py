"""Sequence model: a small GRU over the CDM time series of each event.

Two heads share the recurrent state: a gate (is the final risk >= 1e-6?) and a value (what is
it, given that it is). Trained on CPU in about a minute. Requires PyTorch (`pip install -e
".[seq]"`).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from raan.collision import data, metrics
from raan.collision.models import AUGMENT_CUTOFFS, N_FOLDS, SEED, best_threshold

MAX_LEN = 8
EPOCHS = 30
HIDDEN = 32
N_SEEDS = 3


@dataclass
class SeqSet:
    ids: np.ndarray
    x: np.ndarray
    mask: np.ndarray
    y: np.ndarray
    cutoff: np.ndarray


def build_seq_training(train_cdms: pd.DataFrame, cutoffs=AUGMENT_CUTOFFS) -> SeqSet:
    target = data.final_risk(train_cdms)
    parts = []
    for cutoff in cutoffs:
        ids, x, mask = data.sequences(train_cdms, cutoff, MAX_LEN)
        keep = np.isin(ids, target.index.to_numpy())
        parts.append(
            (ids[keep], x[keep], mask[keep], target.loc[ids[keep]].to_numpy(),
             np.full(keep.sum(), cutoff))
        )  # fmt: skip
    return SeqSet(*(np.concatenate([p[k] for p in parts]) for k in range(5)))


class Standardiser:
    """Per-feature standardisation fitted on real (unpadded) training steps; NaN → 0."""

    def fit(self, x: np.ndarray, mask: np.ndarray) -> Standardiser:
        flat = x[mask > 0]
        self.mean = np.nanmean(flat, axis=0)
        self.std = np.nanstd(flat, axis=0) + 1e-6
        return self

    def transform(self, x: np.ndarray, mask: np.ndarray) -> np.ndarray:
        z = (x - self.mean) / self.std
        z = np.nan_to_num(z, nan=0.0, posinf=0.0, neginf=0.0)
        return (z * mask[..., None]).astype(np.float32)


def _train_one(x, mask, y, seed: int):
    import torch
    from torch import nn

    torch.manual_seed(seed)
    torch.set_num_threads(4)

    class Net(nn.Module):
        def __init__(self, n_features: int):
            super().__init__()
            self.gru = nn.GRU(n_features + 1, HIDDEN, batch_first=True)
            self.gate = nn.Linear(HIDDEN, 1)
            self.value = nn.Linear(HIDDEN, 1)

        def forward(self, x, mask):
            # Sequences are right-aligned, so the last step is always the latest usable CDM.
            out, _ = self.gru(torch.cat([x, mask[..., None]], dim=-1))
            h = out[:, -1]
            return self.gate(h).squeeze(-1), self.value(h).squeeze(-1)

    net = Net(x.shape[-1])
    opt = torch.optim.AdamW(net.parameters(), lr=3e-3, weight_decay=1e-2)
    xt, mt = torch.from_numpy(x), torch.from_numpy(mask)
    hr = torch.from_numpy((y >= metrics.THRESHOLD).astype(np.float32))
    # value target is expressed relative to the threshold so that 0 = "exactly 1e-6"
    val = torch.from_numpy(
        (np.maximum(y, metrics.THRESHOLD) - metrics.THRESHOLD).astype(np.float32)
    )
    pos_weight = torch.tensor(min(float((1 - hr).sum() / max(hr.sum(), 1.0)), 30.0))
    bce = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    generator = torch.Generator().manual_seed(seed)
    n = len(y)
    for _epoch in range(EPOCHS):
        net.train()
        perm = torch.randperm(n, generator=generator)
        for start in range(0, n, 256):
            batch = perm[start : start + 256]
            logit, value = net(xt[batch], mt[batch])
            loss = bce(logit, hr[batch])
            if hr[batch].sum() > 0:
                loss = loss + ((value - val[batch]) ** 2 * hr[batch]).sum() / hr[batch].sum()
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            opt.step()
    net.eval()

    def predict(x_new: np.ndarray, mask_new: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        with torch.no_grad():
            logit, value = net(torch.from_numpy(x_new), torch.from_numpy(mask_new))
        prob = torch.sigmoid(logit).numpy()
        return prob, np.clip(value.numpy() + metrics.THRESHOLD, metrics.THRESHOLD, -1.0)

    return predict


def _fit_predict(train: SeqSet, rows: np.ndarray, x_new, mask_new):
    scaler = Standardiser().fit(train.x[rows], train.mask[rows])
    x = scaler.transform(train.x[rows], train.mask[rows])
    x_new = scaler.transform(x_new, mask_new)
    probs, values = [], []
    for k in range(N_SEEDS):
        predict = _train_one(x, train.mask[rows], train.y[rows], SEED + k)
        p, v = predict(x_new, mask_new)
        probs.append(p)
        values.append(v)
    return np.mean(probs, axis=0), np.mean(values, axis=0)


@dataclass
class SeqResult:
    threshold: float
    cv_loss: float
    oof_prob: np.ndarray
    oof_final: np.ndarray
    test_prob: np.ndarray
    test_pred: np.ndarray
    n_parameters: int


def fit_gru(train_cdms: pd.DataFrame, test_cdms: pd.DataFrame) -> SeqResult:
    from sklearn.model_selection import GroupKFold

    train = build_seq_training(train_cdms)
    proto = train.cutoff == data.CUTOFF_DAYS
    oof_prob = np.full(len(train.y), np.nan)
    oof_value = np.full(len(train.y), np.nan)
    all_rows = np.arange(len(train.y))
    for train_idx, valid_idx in GroupKFold(n_splits=N_FOLDS).split(all_rows, groups=train.ids):
        valid_idx = valid_idx[proto[valid_idx]]
        p, v = _fit_predict(train, train_idx, train.x[valid_idx], train.mask[valid_idx])
        oof_prob[valid_idx], oof_value[valid_idx] = p, v
    threshold, cv_loss = best_threshold(oof_prob[proto], oof_value[proto], train.y[proto])

    test_ids, test_x, test_mask = data.sequences(test_cdms, data.CUTOFF_DAYS, MAX_LEN)
    assert np.all(np.diff(test_ids) > 0)
    prob, value = _fit_predict(train, all_rows, test_x, test_mask)
    n_features = test_x.shape[-1] + 1
    n_params = 3 * HIDDEN * (n_features + HIDDEN) + 6 * HIDDEN + 2 * (HIDDEN + 1)
    return SeqResult(
        threshold, cv_loss, oof_prob[proto], train.y[proto], prob,
        np.where(prob >= threshold, value, metrics.CLIP_VALUE), n_params,
    )  # fmt: skip
