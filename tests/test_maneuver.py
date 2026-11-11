"""Manoeuvre detection: signal construction, detectors and the event-matching protocol."""

import numpy as np
import pytest
from sgp4.api import WGS72, Satrec

from raan.maneuver import detect, tle
from raan.maneuver.tle import Intervals

L1 = "1 25544U 98067A   19343.69339541  .00001764  00000-0  38792-4 0  9991"
L2 = "2 25544  51.6439 211.2001 0007417  17.6667  85.6398 15.50103472202482"


def make_intervals(n, **signals):
    t = np.arange(n + 1) * 86400.0
    base = dict(
        t_start=t[:-1], t_end=t[1:], dt_days=np.ones(n), da_m=np.zeros(n), di_mdeg=np.zeros(n),
        de=np.zeros(n), res_r_km=np.zeros(n), res_t_km=np.zeros(n), res_n_km=np.zeros(n),
    )  # fmt: skip
    base.update(signals)
    return Intervals(**base)


def test_rtn_residual_geometry():
    sat = Satrec.twoline2rv(L1, L2, WGS72)
    r, t, n = tle.rtn_residual(sat, sat, 0.0)
    assert max(abs(r), abs(t), abs(n)) < 1e-9
    # same orbit, 0.1 deg further along (mean anomaly): ~0.1 deg x 6,795 km = 11.9 km ahead,
    # i.e. a positive along-track residual with almost nothing radial or cross-track
    ahead = Satrec.twoline2rv(L1, L2.replace(" 85.6398 ", " 85.7398 "), WGS72)
    r, t, n = tle.rtn_residual(ahead, sat, 0.0)
    assert t == pytest.approx(11.86, abs=0.1)
    assert abs(r) < 0.05 and abs(n) < 0.01
    # a lower (faster) orbit propagated for a day runs ahead of the original one
    faster = Satrec.twoline2rv(L1, L2.replace("15.50103472", "15.50203472"), WGS72)
    e0, r0, _ = sat.sgp4_tsince(1440.0)
    e1, r1, v1 = faster.sgp4_tsince(1440.0)
    lead = np.dot(np.subtract(r1, r0), np.asarray(v1) / np.linalg.norm(v1))
    assert e0 == e1 == 0 and lead > 20.0  # 0.001 rev/day = 0.36 deg = ~42 km per day


def test_history_sorts_and_deduplicates_epochs():
    later = L1.replace("19343.69339541", "19344.69339541")
    h = tle.history_from_pairs("x", [(later, L2), (L1, L2), (L1, L2)])
    assert len(h.t) == 2 and np.all(np.diff(h.t) > 0)
    assert h.satcat == 25544 and h.a_km[0] == pytest.approx(6795, abs=10)
    with pytest.raises(ValueError):
        tle.parse_tle_text(L1 + "\n")


def test_trailing_z_is_causal():
    rng = np.random.default_rng(0)
    x = rng.normal(0, 1, 200)
    z1 = detect.trailing_robust_z(x)
    x2 = x.copy()
    x2[150:] += 100.0
    z2 = detect.trailing_robust_z(x2)
    assert np.array_equal(z1[:150], z2[:150])  # the future never changes past scores
    assert abs(z2[150]) > 30


def test_level_shift_sees_steps_but_not_single_bad_sets():
    t = np.arange(120) * 86400.0
    rng = np.random.default_rng(1)
    base = 7000e3 - 0.5 * np.arange(120) + rng.normal(0, 0.2, 120)  # drag decay 0.5 m/day
    step = base.copy()
    step[60:] += 30.0  # a burn raising the orbit by 30 m
    spike = base.copy()
    spike[60] += 30.0  # one bad element set
    zs = np.abs(detect.trailing_robust_z_gap(detect.level_shift(step, t)))
    zk = np.abs(detect.trailing_robust_z_gap(detect.level_shift(spike, t)))
    # medians of three sets: the step registers on the burn interval (59) and its two
    # neighbours, which the detector later merges into one detection
    assert zs[59] > 20 and int(np.argmax(zs)) in (58, 59, 60)
    assert set(np.flatnonzero(zs > 20)) <= {58, 59, 60}
    assert zk.max() < 8 < zs.max()
    # the constant decay itself must not look like a manoeuvre
    quiet = np.abs(detect.trailing_robust_z_gap(detect.level_shift(base, t)))
    assert np.percentile(quiet, 95) < 6


def test_cusum_accumulates_small_persistent_shifts():
    z = {k: np.zeros(100) for k in ("da", "di")}
    z["da"][50:56] = 3.0  # six consecutive 3-sigma increments: no single one is alarming
    stat = detect.cusum_score(z, drift=1.5)
    assert stat[49] == 0 and stat[55] == pytest.approx(6 * 1.5)
    assert stat[70] == 0  # decays back


def test_interval_labels_and_truth_clustering():
    iv = make_intervals(10)
    burns = np.array([0.5, 3.2, 3.9, 9.5]) * 86400.0
    assert detect.interval_labels(iv, burns).tolist() == [1, 0, 0, 1, 0, 0, 0, 0, 0, 1]
    assert detect.cluster_truth(burns).tolist() == (np.array([0.5, 3.2, 9.5]) * 86400).tolist()
    assert detect.interval_labels(iv, np.array([])).sum() == 0


def test_detections_merge_adjacent_flags():
    iv = make_intervals(12)
    score = np.zeros(12)
    score[[2, 3, 5, 9]] = [5, 9, 6, 7]  # 2,3 and 5 merge (one-interval gap allowed); 9 separate
    dets = detect.detections_from_scores(iv, score, 4.0)
    assert [(d.t_start / 86400, d.t_end / 86400, d.k_peak) for d in dets] == [(2, 6, 3), (9, 10, 9)]
    assert detect.detections_from_scores(iv, score, 100.0) == []


def test_matching_is_one_to_one_and_respects_the_lag_window():
    iv = make_intervals(40)
    burns = np.array([10.4, 20.5, 30.5]) * 86400.0
    score = np.zeros(40)
    score[12] = 10  # interval (12, 13]: burn at 10.4 is 1.6 d before its start → inside 2 d lag
    score[25] = 10  # 4.5 d after the burn at 20.5 → too late, a false alarm
    counts, dets, truth, found = detect.evaluate(iv, score, burns, 5.0)
    assert (counts.tp, counts.fp, counts.fn) == (1, 1, 2)
    assert found.tolist() == [True, False, False] and [d.matched for d in dets] == [True, False]
    assert counts.precision == 0.5 and counts.recall == pytest.approx(1 / 3)
    # one detection cannot explain two burns
    close = np.array([10.2, 12.0]) * 86400.0
    c2, *_ = detect.evaluate(iv, score, close, 5.0)
    assert c2.tp == 1 and c2.fn == 1


def test_scores_outside_the_labelled_period_are_ignored():
    iv = make_intervals(100)
    burns = np.array([50.5]) * 86400.0
    score = np.zeros(100)
    score[[5, 50, 95]] = 10
    counts, dets, *_ = detect.evaluate(iv, score, burns, 5.0)
    assert (counts.tp, counts.fp, counts.fn) == (1, 0, 0) and len(dets) == 1


def test_feature_matrix_shape_and_neighbours():
    iv = make_intervals(20)
    z = {k: np.zeros(20) for k in (*detect.SIGNALS, "shift_a", "shift_i")}
    z["da"][10] = 7.0
    x, names = detect.features(iv, z, is_geo=True)
    assert x.shape == (20, len(names)) and len(set(names)) == len(names)
    assert x[11, names.index("absz_da_lag1")] == 7.0
    assert x[9, names.index("absz_da_lead1")] == 7.0
    assert x[:, names.index("is_geo")].all()


def test_counts_arithmetic():
    c = detect.Counts(8, 2, 2) + detect.Counts(0, 0, 0)
    assert c.precision == 0.8 and c.recall == 0.8 and c.f1 == pytest.approx(0.8)
    assert detect.Counts().f1 == 0.0
