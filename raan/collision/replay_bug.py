"""Replay of a bug found while this lab was being built (documentation, not part of the pipeline).

The feature "previous risk" (risk of the second-to-last usable CDM of an event) was first
computed with ``groupby("event_id")["risk"].nth(-2)`` and assigned to the event table. In pandas
2 ``nth`` keeps the *original row labels*, so the assignment aligned row labels with event ids:
no error, a plausible-looking column, and the wrong value for about half of the events. A unit
test on a small hand-made table (``tests/test_collision.py``) exposed it.

This script puts the bug back, retrains the gate and prints its test loss next to the published
one, so the "before → after" figure quoted in the write-up can be checked.

Run: ``python -m raan.collision.replay_bug`` (about one minute; needs ``make data``)
"""

from __future__ import annotations

import warnings

from raan.collision import data, metrics, models


def buggy_event_table(cdms, cutoff: float = data.CUTOFF_DAYS):
    table = _correct(cdms, cutoff)
    usable = cdms[cdms["time_to_tca"] >= cutoff].sort_values(
        ["event_id", "time_to_tca"], ascending=[True, False]
    )
    previous = usable.groupby("event_id", sort=True)["risk"].nth(-2)  # indexed by row label
    table["risk_prev"] = previous.reindex(table.index).fillna(table["risk"])
    table["risk_delta_last"] = table["risk"] - table["risk_prev"]
    return table


_correct = data.event_table


def main() -> None:
    warnings.filterwarnings("ignore", message="X does not have valid feature names")
    train, test, truth = data.load()
    good = _correct(test)
    data.event_table = buggy_event_table
    models.nested_cv_loss = lambda ts: float("nan")  # not needed here, saves a minute
    try:
        table = data.event_table(test)
        wrong = float((table["risk_prev"] != good["risk_prev"]).mean())
        gbm = models.fit_gbm(models.build_training_set(train), table)
    finally:
        data.event_table = _correct
    loss = metrics.score(truth.to_numpy(), gbm.test_gate).L
    print(f"events with a wrong 'previous risk' (test set): {wrong * 100:.0f}%")
    print(f"gate, test L with the bug:    {loss:.3f}")
    print("gate, test L after the fix:   see web/public/data/collision.json (results.gbm_gate.L)")


if __name__ == "__main__":
    main()
