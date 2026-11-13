"""Collision lab: the official metric, the protocol filters and (if data is present) the
exact reproduction of the published baselines."""

import numpy as np
import pandas as pd
import pytest

from raan.collision import data, metrics, models


def test_clip_sends_everything_below_threshold_to_minus_6_001():
    out = metrics.clip_predictions(np.array([-30.0, -6.0001, -6.0, -5.9, -2.0]))
    assert out.tolist() == [-6.001, -6.001, -6.0, -5.9, -2.0]


def test_fbeta_weights_recall_more_than_precision():
    assert metrics.fbeta(1.0, 1.0) == pytest.approx(1.0)
    assert metrics.fbeta(0.0, 0.0) == 0.0
    assert metrics.fbeta(0.5, 1.0) > metrics.fbeta(1.0, 0.5)
    assert metrics.fbeta(0.5, 1.0) == pytest.approx(5 * 0.5 / (4 * 0.5 + 1.0))


def test_score_hand_computed_example():
    truth = np.array([-5.0, -4.0, -7.0, -30.0, -5.5])
    pred = np.array([-5.5, -6.5, -5.0, -20.0, -5.5])
    s = metrics.score(truth, pred)
    # high-risk truth: events 0, 1, 4; predicted high: 0, 2, 4
    assert (s.tp, s.fp, s.fn, s.tn) == (2, 1, 1, 1)
    assert s.precision == pytest.approx(2 / 3) and s.recall == pytest.approx(2 / 3)
    assert s.f2 == pytest.approx(2 / 3)
    # squared errors on high-risk events: 0.25, (−4 + 6.001)², 0
    assert s.mse_hr == pytest.approx((0.25 + 2.001**2 + 0.0) / 3)
    assert s.L == pytest.approx(s.mse_hr / s.f2)
    assert s.n_high_risk == 3 and s.n_events == 5


def test_score_perfect_and_degenerate_cases():
    truth = np.array([-5.0, -30.0])
    assert metrics.score(truth, truth).L == 0.0
    assert metrics.score(truth, np.array([-30.0, -30.0])).L == float("inf")  # F2 = 0
    with pytest.raises(ValueError):
        metrics.score(truth, np.array([-5.0]))


def test_low_risk_value_does_not_matter_below_threshold():
    truth = np.array([-5.0, -8.0, -30.0])
    a = metrics.score(truth, np.array([-5.0, -6.5, -29.0]))
    b = metrics.score(truth, np.array([-5.0, -25.0, -7.0]))
    assert a == b


def test_bootstrap_is_deterministic_and_paired():
    rng = np.random.default_rng(1)
    truth = np.where(rng.random(400) < 0.2, -5.0, -20.0) + rng.normal(0, 0.3, 400)
    good = truth + rng.normal(0, 0.1, 400)
    bad = truth + rng.normal(0, 1.0, 400)
    one = metrics.bootstrap(truth, {"ref": bad, "good": good}, "ref", n_boot=200, seed=3)
    two = metrics.bootstrap(truth, {"ref": bad, "good": good}, "ref", n_boot=200, seed=3)
    assert one == two
    assert one["ref"]["delta_vs_reference_ci95"] == [0.0, 0.0]
    assert one["good"]["p_better_than_reference"] > 0.95
    assert one["good"]["delta_vs_reference_ci95"][1] < 0


def test_reliability_of_a_perfectly_calibrated_forecast():
    rng = np.random.default_rng(0)
    prob = rng.random(20000)
    label = rng.random(20000) < prob
    rel = metrics.reliability(prob, label, n_bins=10)
    assert rel["ece"] < 0.02
    assert sum(b["n"] for b in rel["bins"]) == 20000
    assert rel["brier"] == pytest.approx(1 / 6, abs=0.01)


def _cdms():
    """Three synthetic events. Event 3 has no CDM within one day of TCA (no valid target)."""
    rows = [
        # event, time_to_tca, risk
        (1, 6.0, -8.0), (1, 4.0, -7.0), (1, 2.5, -6.5), (1, 1.5, -5.0), (1, 0.3, -4.5),
        (2, 5.0, -5.0), (2, 2.1, -5.5), (2, 0.5, -30.0),
        (3, 6.0, -9.0), (3, 3.0, -9.5),
    ]  # fmt: skip
    frame = pd.DataFrame(rows, columns=["event_id", "time_to_tca", "risk"])
    for col in data.BASE_FEATURES + data.SEQ_FEATURES:
        if col not in frame:
            frame[col] = 1.0
    frame["c_object_type"] = "DEBRIS"
    return frame


def test_final_risk_requires_a_cdm_within_one_day():
    target = data.final_risk(_cdms())
    assert target.to_dict() == {1: -4.5, 2: -30.0}


def test_event_table_never_uses_cdms_inside_the_cutoff():
    table = data.event_table(_cdms(), cutoff=2.0)
    assert table.loc[1, "risk"] == -6.5  # not −5.0 (1.5 d) nor −4.5 (0.3 d)
    assert table.loc[1, "n_cdms"] == 3
    assert table.loc[1, "risk_prev"] == -7.0
    assert table.loc[2, "risk_prev"] == -5.0
    assert table.loc[1, "risk_delta_last"] == pytest.approx(0.5)
    assert table.loc[1, "risk_max"] == -6.5 and table.loc[1, "risk_min"] == -8.0
    assert table.loc[2, "risk"] == -5.5 and table.loc[2, "frac_cdms_high_risk"] == 1.0
    assert table.loc[1, "risk_slope"] < 0  # risk rises as time_to_tca falls
    assert table.loc[1, "c_type_debris"] == 1.0
    later = data.event_table(_cdms(), cutoff=4.0)
    assert later.loc[1, "risk"] == -7.0 and 3 in later.index


def test_sequences_are_right_aligned_and_masked():
    ids, x, mask = data.sequences(_cdms(), cutoff=2.0, max_len=4)
    assert ids.tolist() == [1, 2, 3]
    risk = data.SEQ_FEATURES.index("risk")
    assert x[0, :, risk].tolist() == [0.0, -8.0, -7.0, -6.5]
    assert mask[0].tolist() == [0.0, 1.0, 1.0, 1.0]
    assert x[1, -1, risk] == -5.5 and mask[1].sum() == 2


def test_lrp_is_the_clipped_latest_risk():
    table = data.event_table(_cdms())
    assert models.latest_risk_prediction(table).tolist() == [-6.001, -5.5, -6.001]


def test_value_model_and_gate():
    latest = np.array([-5.0, -4.0, -3.0, -9.0, -20.0])
    final = np.array([-5.2, -4.4, -3.6, -5.0, -30.0])
    vm = models.ValueModel.fit(latest, final)
    pred = vm.predict(np.array([-30.0, -4.0, 5.0]))
    assert np.all(pred >= -6.0) and np.all(pred <= -1.0)
    gated = models.gated_prediction(np.array([0.9, 0.1]), np.array([-5.0, -5.0]), 0.5)
    assert gated.tolist() == [-5.0, -6.001]


def test_training_set_keeps_events_together_across_folds():
    copies = [_cdms().assign(event_id=lambda d, k=k: d.event_id + 10 * k) for k in range(6)]
    frame = pd.concat(copies)  # note: duplicate row labels, as after any concat
    ts = models.build_training_set(frame, cutoffs=(2.0, 4.0))
    assert set(np.unique(ts.cutoff)) == {2.0, 4.0}
    assert ts.protocol_rows.sum() == 12  # events 1 and 2, six copies
    for train_idx, valid_idx in models.folds(ts, n_folds=3):
        assert not set(ts.groups[train_idx]) & set(ts.groups[valid_idx])


HAVE_DATA = (data.CAC_DIR / "test_data.csv").exists()


@pytest.mark.skipif(not HAVE_DATA, reason="ESA dataset not downloaded")
def test_reproduces_published_baselines_on_the_real_test_set():
    """Uriot et al., Table 3: LRP L = 0.694 (MSE_HR 0.513, F2 0.739); CRP L = 2.5."""
    _train, test, truth = data.load()
    table = data.event_table(test)
    lrp = metrics.score(truth.to_numpy(), models.latest_risk_prediction(table))
    assert round(lrp.L, 3) == 0.694
    assert round(lrp.mse_hr, 3) == 0.513
    assert round(lrp.f2, 3) == 0.739
    assert (lrp.n_events, lrp.n_high_risk) == (2167, 150)
    crp = metrics.score(truth.to_numpy(), models.constant_risk_prediction(len(truth)))
    assert round(crp.L, 1) == 2.5
