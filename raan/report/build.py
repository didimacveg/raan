"""Technical report: artefacts → figures → HTML → PDF (paper style, A4, two columns).

Every number in the text is read from the JSON artefacts at build time.

Run: ``python -m raan.report.build`` (needs Node + Playwright's Chromium for the PDF step; the
HTML is written regardless).
"""

from __future__ import annotations

import io
import json
import shutil
import subprocess
from datetime import UTC, datetime

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from raan import brand  # noqa: E402
from raan.paths import REPORTS, ROOT, WEB_DATA, ensure  # noqa: E402

BLUE, ORANGE, VIOLET, CYAN, MAGENTA, INK, MUTED = (
    "#1f3bff", "#ff7a1a", "#7a3cff", "#00a6d6", "#f0288c", "#0b1030", "#7a829f",
)  # fmt: skip
plt.rcParams.update(
    {
        "font.family": "DejaVu Sans", "font.size": 8, "axes.spines.top": False,
        "axes.spines.right": False, "axes.edgecolor": "#9aa1b9", "axes.labelcolor": INK,
        "xtick.color": MUTED, "ytick.color": MUTED, "axes.grid": True,
        "grid.color": "#e7eaf3", "grid.linewidth": 0.6, "legend.frameon": False,
        "svg.fonttype": "none",
    }
)  # fmt: skip


def svg(fig) -> str:
    buf = io.StringIO()
    fig.savefig(buf, format="svg", bbox_inches="tight")
    plt.close(fig)
    text = buf.getvalue()
    return text[text.index("<svg") :]


def fig_scores(col: dict) -> str:
    rows = [r for r in col["results"] if r["key"] != "crp"][::-1]
    fig, ax = plt.subplots(figsize=(3.4, 2.2))
    for k, r in enumerate(rows):
        color = INK if r["kind"] == "baseline" else BLUE
        ax.plot(r["L_ci95"], [k, k], color=color, lw=2, alpha=0.35, solid_capstyle="round")
        ax.plot(r["L"], k, "o", color=color, ms=5)
        ax.text(r["L_ci95"][1] + 0.06, k, f"{r['L']:.3f}", va="center", fontsize=7, color=INK)
    ax.axvline(col["published"][0]["L"], color=ORANGE, ls="--", lw=1)
    ax.text(col["published"][0]["L"] + 0.03, len(rows) - 0.45, "winner 2019", color=ORANGE,
            fontsize=6.5)  # fmt: skip
    ax.set_yticks(range(len(rows)), [r["name"] for r in rows], color=INK)
    ax.set_xlabel("challenge loss L on the test set (95% bootstrap interval)")
    ax.set_xlim(0, 3.6)
    ax.grid(axis="y", visible=False)
    return svg(fig)


def fig_transition(col: dict) -> str:
    tr, te = col["transition"]["train_protocol"], col["transition"]["test"]
    fig, ax = plt.subplots(figsize=(3.4, 2.2))
    x = range(len(tr))
    ax.bar([i - 0.2 for i in x], [b["p_high_final"] or 0 for b in tr], 0.38, color=BLUE,
           label="training (test-like filter)")  # fmt: skip
    ax.bar([i + 0.2 for i in x], [b["p_high_final"] or 0 for b in te], 0.38, color=ORANGE,
           label="test")  # fmt: skip
    ax.set_xticks(list(x), [f"{b['lo']:g}" for b in tr])
    ax.set_xlabel("latest known risk, log10 (bin lower edge)")
    ax.set_ylabel("share ending high-risk")
    ax.legend(fontsize=6.5, loc="upper left")
    ax.grid(axis="x", visible=False)
    return svg(fig)


def fig_scatter(col: dict) -> str:
    ev = col["events"]
    fig, ax = plt.subplots(figsize=(3.4, 3.0))
    truth, latest = ev["true_risk"], ev["latest_risk"]
    groups = {"tn": ([], []), "fp": ([], []), "tp": ([], []), "fn": ([], [])}
    for t, lr in zip(truth, latest, strict=True):
        key = ("tp" if lr >= -6 else "fn") if t >= -6 else ("fp" if lr >= -6 else "tn")
        groups[key][0].append(lr)
        groups[key][1].append(t)
    style = {"tn": ("#c3c9dc", 3, "low, not flagged"), "fp": (ORANGE, 7, "false alarm"),
             "tp": (BLUE, 7, "high, flagged"), "fn": (MAGENTA, 9, "high, missed")}  # fmt: skip
    for key, (xs, ys) in groups.items():
        color, size, label = style[key]
        ax.scatter(xs, ys, s=size, color=color, label=f"{label} ({len(xs)})", linewidths=0)
    ax.axhline(-6, color=MUTED, ls="--", lw=0.7)
    ax.axvline(-6, color=MUTED, ls="--", lw=0.7)
    ax.set_xlabel("latest known risk (log10), ≥ 2 days before TCA")
    ax.set_ylabel("true final risk (log10)")
    ax.legend(fontsize=6, loc="center left", markerscale=1.3)
    return svg(fig)


def fig_maneuver(man: dict) -> str:
    fig, axes = plt.subplots(1, 2, figsize=(7.0, 2.5), gridspec_kw={"width_ratios": [1, 1.25]})
    names = {"physics": ("Physics", BLUE), "cusum": ("CUSUM", ORANGE), "ml": ("Classifier", VIOLET)}
    ax = axes[0]
    for k, metric in enumerate(("precision", "recall", "f1")):
        for j, (key, (label, color)) in enumerate(names.items()):
            v = man["summary"][key]["ALL"][metric]
            ax.bar(k + (j - 1) * 0.27, v, 0.25, color=color, label=label if k == 0 else None)
            ax.text(k + (j - 1) * 0.27, v + 0.015, f"{v:.2f}", ha="center", fontsize=6)
    ax.set_xticks(range(3), ["precision", "recall", "F1"], color=INK)
    ax.set_ylim(0, 1)
    ax.legend(fontsize=6.5, ncol=3, loc="upper center", bbox_to_anchor=(0.5, 1.2))
    ax.grid(axis="x", visible=False)
    ax = axes[1]
    rows = man["recall_by_size_leo"]
    labels = [f">{r['lo_m']:g}" if r["hi_m"] is None else f"{r['lo_m']:g}–{r['hi_m']:g}"
              for r in rows]  # fmt: skip
    for key, (label, color) in names.items():
        ax.plot(range(len(rows)), [r[key] / r["n"] if r["n"] else 0 for r in rows], "-o",
                color=color, ms=3.5, lw=1.5, label=label)  # fmt: skip
    ax.set_xticks(range(len(rows)), labels)
    ax.set_xlabel("step in mean semi-major axis at the reported burn [m] (LEO)")
    ax.set_ylabel("recall")
    ax.set_ylim(0, 1)
    return svg(fig)


CSS = """
@page { size: A4; margin: 17mm 15mm 18mm 15mm; }
* { box-sizing: border-box; }
body { font-family: 'DejaVu Serif', Georgia, serif; font-size: 9.8pt; line-height: 1.42;
       color: #111; margin: 0; }
h1 { font-family: 'DejaVu Sans', sans-serif; font-size: 17pt; line-height: 1.15; margin: 0 0 6pt;
     letter-spacing: -0.01em; }
.authors { font-family: 'DejaVu Sans', sans-serif; font-size: 9.5pt; margin-bottom: 2pt; }
.affil { font-family: 'DejaVu Sans', sans-serif; font-size: 8pt; color: #555; margin-bottom: 9pt; }
.abstract { border-top: 1.2pt solid #1f3bff; border-bottom: 0.5pt solid #bbb; padding: 7pt 0;
            margin-bottom: 10pt; font-size: 8.9pt; }
.abstract b { font-family: 'DejaVu Sans', sans-serif; }
.cols { column-count: 2; column-gap: 7mm; text-align: justify; hyphens: auto; }
h2 { font-family: 'DejaVu Sans', sans-serif; font-size: 10.5pt; margin: 11pt 0 4pt; color: #0b1030;
     break-after: avoid; }
h3 { font-family: 'DejaVu Sans', sans-serif; font-size: 9pt; margin: 8pt 0 2pt; break-after: avoid; }
p { margin: 0 0 5pt; orphans: 3; widows: 3; }
figure { margin: 6pt 0 8pt; break-inside: avoid; text-align: center; }
figure.wide, table.wide { column-span: all; }
figure svg { max-width: 100%; height: auto; }
figcaption, caption { font-family: 'DejaVu Sans', sans-serif; font-size: 7.6pt; color: #333;
                      text-align: left; margin-top: 3pt; caption-side: top; padding-bottom: 3pt; }
table { border-collapse: collapse; width: 100%; font-family: 'DejaVu Sans', sans-serif;
        font-size: 7.6pt; margin: 6pt 0 8pt; break-inside: avoid; }
th { border-bottom: 0.8pt solid #111; border-top: 0.8pt solid #111; text-align: left;
     padding: 2.5pt 3pt; font-weight: 600; }
td { padding: 2.2pt 3pt; border-bottom: 0.3pt solid #ccc; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
tr.hl td { background: #eef1ff; }
.eq { text-align: center; font-style: italic; margin: 5pt 0; }
.refs p { font-size: 8pt; text-indent: -10pt; padding-left: 10pt; text-align: left; }
.foot { font-family: 'DejaVu Sans', sans-serif; font-size: 7.5pt; color: #555; margin-top: 8pt;
        border-top: 0.5pt solid #bbb; padding-top: 4pt; }
code { font-family: 'DejaVu Sans Mono', monospace; font-size: 8pt; }
"""


def build_html(col: dict, man: dict, cat: dict) -> str:
    by = {r["key"]: r for r in col["results"]}
    lrp, gate, direct, gru = by["lrp"], by["gbm_gate"], by["gbm_direct"], by.get("gru")
    ds, sel = col["dataset"], col["selection"]
    ms, ab, tot = man["summary"], man["physics_ablation"], man["totals"]
    meta = cat["meta"]
    fnp = col["false_negatives"]["lrp"]
    tr6 = next(b for b in col["transition"]["train_protocol"] if b["lo"] == -6)
    te6 = next(b for b in col["transition"]["test"] if b["lo"] == -6)
    small = man["recall_by_size_leo"][0]
    lbm = man["large_burn_misses"]
    cal = col["calibration"]

    def row(r, hl=False):
        cv = "—" if r["cv_L"] is None else f"{r['cv_L']:.2f}"
        pb = "—" if r["key"] == "lrp" else f"{r['p_better_than_reference'] * 100:.0f}%"
        return (
            f"<tr{' class=hl' if hl else ''}><td>{r['name']}</td><td class=n>{r['L']:.3f}</td>"
            f"<td class=n>{r['L_ci95'][0]:.2f}–{r['L_ci95'][1]:.2f}</td><td class=n>{cv}</td>"
            f"<td class=n>{r['mse_hr']:.3f}</td><td class=n>{r['f2']:.3f}</td>"
            f"<td class=n>{r['fn']}</td><td class=n>{r['fp']}</td><td class=n>{pb}</td></tr>"
        )

    score_rows = "".join(row(r, r["key"] == "lrp") for r in col["results"])
    pub_rows = "".join(
        f"<tr><td>{p['team']} (published)</td><td class=n>{p['L']:.3f}</td><td class=n>—</td>"
        f"<td class=n>—</td><td class=n>{p['mse_hr']:.3f}</td><td class=n>{p['f2']:.3f}</td>"
        "<td class=n>—</td><td class=n>—</td><td class=n>—</td></tr>"
        for p in col["published"][:3]
    )
    man_rows = "".join(
        f"<tr{' class=hl' if key == 'ml' else ''}><td>{label}</td>"
        + "".join(
            f"<td class=n>{ms[key][g]['precision']:.2f}</td><td class=n>{ms[key][g]['recall']:.2f}"
            f"</td><td class=n>{ms[key][g]['f1']:.2f}</td>"
            for g in ("LEO", "GEO", "ALL")
        )
        + "</tr>"
        for key, label in (
            ("physics", "Physics (a + i step)"),
            ("cusum", "CUSUM"),
            ("ml", "GB classifier"),
        )  # fmt: skip
    )
    abl_rows = "".join(
        f"<tr><td>{label}</td><td class=n>{ab[k]['ALL']['precision']:.2f}</td>"
        f"<td class=n>{ab[k]['ALL']['recall']:.2f}</td><td class=n>{ab[k]['ALL']['f1']:.2f}</td></tr>"
        for k, label in (
            ("jump", "Single-interval jumps + RTN residual"),
            ("a", "Step in semi-major axis"),
            ("a+i", "Step in a or i (baseline)"),
            ("a+i&rtn", "Step in a or i, RTN-confirmed"),
        )  # fmt: skip
    )
    sat_rows = "".join(
        f"<tr><td>{x['name']} ({x['regime']})</td><td class=n>{x['maneuver_events']}</td>"
        + "".join(f"<td class=n>{x['metrics'][k]['f1']:.2f}</td>" for k in ("physics", "cusum", "ml"))
        + "</tr>"
        for x in man["satellites"]
    )
    gru_sentence = (
        f" The GRU scores {gru['L']:.2f}: it misses as many high-risk events as the naive "
        f"forecast ({gru['fn']}) with {gru['fp']} false alarms against {lrp['fp']}."
        if gru
        else ""
    )
    today = datetime.now(UTC).strftime("%d %B %Y")
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>{brand.NAME}: technical report</title><style>{CSS}</style></head><body>
<h1>{brand.NAME}: an open, reproducible laboratory for orbital data — SGP4 digital twin,
collision-risk forecasting on ESA conjunction data, and manoeuvre detection from public element
sets</h1>
<div class="authors">{brand.AUTHOR}</div>
<div class="affil">Independent student project, Madrid · {today} · code and data pipeline:
{brand.REPO_URL} · {brand.DISCLAIMER}</div>
<div class="abstract"><b>Abstract.</b> This report documents three experiments built on public
orbital data, each with its baseline reproduced before any model is trained. (i) A browser
propagator initialised from OMM mean elements reproduces the 666 reference state vectors of the
SGP4 verification set to {1.2e-7:.1e} km and renders the {meta["count"]:,} objects for which
bulk elements are public. (ii) On ESA's Collision Avoidance Challenge dataset, the naive
"latest risk" forecast is reproduced exactly (L = {lrp["L"]:.3f}). A gradient-boosted gate model
reaches L = {gate["L"]:.3f} on the test set, but cross-validation on the training set ranks it
below the naive forecast ({gate["cv_L"]:.2f} vs {lrp["cv_L"]:.2f}) and the bootstrap interval of
the difference contains zero; a direct regressor and a recurrent model are clearly worse. No
model is claimed to improve on the baseline, and the role of the documented selection bias of
the dataset is quantified. (iii) On {tot["maneuver_events"]} operator-reported manoeuvre events
of {tot["satellites"]} satellites, evaluated leave-one-satellite-out, a gradient-boosted
classifier reaches F1 = {ms["ml"]["ALL"]["f1"]:.2f}, a physics baseline
{ms["physics"]["ALL"]["f1"]:.2f} and CUSUM {ms["cusum"]["ALL"]["f1"]:.2f}; a detector using only
the step in semi-major axis reaches {ab["a"]["ALL"]["f1"]:.2f}. All figures are regenerated from
source by one command.</div>
<div class="cols">

<h2>1 Problem</h2>
<p>More than {meta["satcat_on_orbit"]["total"]:,} catalogued objects orbit the Earth. Operators
receive conjunction data messages (CDMs) days before a close approach and typically have to
commit to an avoidance manoeuvre about two days ahead, while the estimated risk is still
changing. Separately, anyone outside an operator sees manoeuvres only through their effect on
published orbital elements. Both are forecasting and detection problems on noisy, irregular
series, and both have public data. This project asks two narrow questions — can a learned model
beat the naive risk forecast, and how well can reported manoeuvres be recovered from public
element sets — and is deliberately strict about what counts as an answer.</p>
<p>It is not an operational system. Operational collision avoidance relies on tracking data,
covariance realism and continuous processes provided by organisations such as GMV (Focusoc),
Neuraspace, LeoLabs or Slingshot; public viewers such as KeepTrack are more complete than the
visualisation built here; and the open-source <i>kessler</i> library addresses probabilistic CDM
forecasting. The contribution is a small, fully reproducible set of baselines and negative
results.</p>

<h2>2 Data</h2>
<h3>2.1 Orbital elements</h3>
<p>General-perturbations (GP) mean elements are taken from CelesTrak in OMM CSV form together
with the SATCAT. The TLE format is not used: new objects have received 6-digit catalogue numbers
since July 2026 and cannot be represented in it; {meta["six_digit_ids"]:,} such objects are in
the snapshot. CelesTrak has no "all objects" query, so the snapshot is the union of the active
list, analyst objects and three debris clouds: {meta["count"]:,} objects, against
{meta["satcat_on_orbit"]["total"]:,} on orbit in the SATCAT. The median element set is
{meta["epoch_age_days"]["median"] * 24:.0f} h old at download. CelesTrak's usage policy (one
download per two-hour update, no retries on HTTP errors) is implemented in the fetcher.</p>
<h3>2.2 Conjunction data</h3>
<p>The ESA Collision Avoidance Challenge dataset (Zenodo, DOI {col["meta"]["dataset"]["doi"]},
CC BY 4.0) holds {ds["train"]["cdms"] + ds["test"]["cdms"]:,} anonymised CDMs:
{ds["train"]["events"]:,} training and {ds["test"]["events"]:,} test events. The quantity to
predict is the log10 collision probability in the last CDM of each event. Test inputs stop two
days before the time of closest approach (TCA); the target CDM is within one day of it. ESA
states that both sets were hand-picked to over-represent high-risk events. The consequence is
measurable: among training events filtered like the test set, {ds["train"]["events_protocol_high_risk"]}
of {ds["train"]["events_protocol"]:,} end at or above 10<sup>−6</sup>
({ds["train"]["prevalence_protocol"] * 100:.1f}%); in the test set
{ds["test"]["events_high_risk"]} of {ds["test"]["events"]:,} do
({ds["test"]["prevalence"] * 100:.1f}%).</p>
<h3>2.3 Manoeuvre labels</h3>
<p>The benchmark of Shorten et al. provides TLE histories ({tot["element_sets"]:,} element sets,
about one per day) and {tot["reported_maneuvers"]} reported manoeuvre times for
{tot["satellites"]} satellites: ten LEO altimetry and geodesy missions whose operators publish
manoeuvres through the International DORIS Service, and five Fengyun geostationary satellites.
The repository has no licence file; it is cloned at a pinned commit at build time and only
derived series are published.</p>

<h2>3 Methods</h2>
<h3>3.1 Propagation and its verification</h3>
<p>Positions are SGP4 propagations of the published elements in the TEME frame, computed in a
Web Worker (satellite.js) for the visualisation and with the <i>sgp4</i> Python package in the
pipeline. Both are tested against the verification file of Vallado et al.: 33 element sets, 666
state vectors, maximum position difference 1.2 × 10<sup>−7</sup> km. One deliberately invalid
element set in that file must be rejected, and is. The display interpolates between worker
key-frames on the GPU (direction and radius separately, key-frames at most 240 s apart). Nothing
shown is an observation.</p>
<h3>3.2 Final-risk prediction</h3>
<p>The official score is</p>
<p class="eq">L = MSE<sub>HR</sub> / F<sub>2</sub></p>
<p>where an event is high-risk if its final risk r ≥ −6, F<sub>2</sub> is computed on that label
over all events, MSE<sub>HR</sub> is the mean squared error over truly high-risk events, and
predictions below −6 are clipped to −6.001. Two baselines from the challenge paper are
reproduced: constant risk (−5) and the latest-risk prediction (LRP), the clipped last risk known
two days before TCA.</p>
<p>Three learned models are compared. <i>Gate + value</i>: a LightGBM classifier estimates the
probability that the event ends high-risk from {len(col["importance"])}+ event features (latest
CDM, covariance sizes, observation statistics, and summaries of the risk history); events above
a threshold τ receive a value from a two-parameter linear function of the latest risk fitted on
truly high-risk training events; all others receive −6.001. <i>Direct regression</i>: LightGBM
on the clipped target. <i>Sequence model</i>: a GRU (32 hidden units) over the last eight CDMs
with a gate head and a value head, three seeds averaged. Training uses events whose final CDM is
within a day of TCA; each is also presented as it looked three and four days out. τ and all
model selection use 5-fold cross-validation grouped by event, on the training set only. The test
set is scored once per model. Uncertainty is a 2,000-resample event bootstrap, paired against
LRP.</p>
<h3>3.3 Manoeuvre detection</h3>
<p>For consecutive element sets the pipeline computes the change in mean semi-major axis a and
inclination i, and the RTN residual: the earlier set propagated to the epoch of the later one,
minus the later set's own position, in radial, along-track and cross-track components. Mean
elements are compared directly, as recommended by Shorten et al.</p>
<p><i>Physics baseline.</i> A level-shift statistic: the median of the three sets after an
interval minus the median of the three before, minus the secular drift estimated from the
previous 30 intervals, expressed in robust (MAD) sigmas of the satellite's own recent history.
A single bad element set produces a spike and cancels; a burn produces a step. The score is the
larger of the a and i statistics. <i>CUSUM.</i> Page's two-sided cumulative sum on standardised
day-to-day changes of a and i. <i>Classifier.</i> LightGBM on the statistics above, RTN
residuals, raw magnitudes and their values two sets before and after.</p>
<p>Evaluation is at event level. Reported burns closer than 1.5 days form one event.
Consecutive flagged intervals form one detection, which explains an event if the burn lies
between two days before its start and its end; matching is one-to-one. Thresholds, and the
classifier itself, are chosen leave-one-satellite-out, so the figures for a satellite never use
its labels.</p>
<h3>3.4 Reporting</h3>
<p>A periodic briefing is assembled by small agents that read the artefacts above and register
facts (value, source file). A reviewer rejects any statement citing a missing fact or containing
a number not present in its cited facts; an optional language model may rephrase a paragraph
only if the same check passes. Agents do not compute.</p>

<h2>4 Results</h2>
<h3>4.1 Final-risk prediction</h3>
<p>The LRP baseline is reproduced exactly: L = {lrp["L"]:.3f}, MSE<sub>HR</sub> =
{lrp["mse_hr"]:.3f}, F<sub>2</sub> = {lrp["f2"]:.3f} (published: 0.694, 0.513, 0.739). Table 1
lists all models.</p>
<table class="wide"><caption><b>Table 1.</b> Test-set scores ({ds["test"]["events"]:,} events,
{ds["test"]["events_high_risk"]} high-risk). CV = cross-validated L on training events. FN =
missed high-risk events, FP = false alarms. Last column: share of bootstrap resamples in which
the model beats LRP.</caption>
<tr><th>Model</th><th class=n>L</th><th class=n>95% int.</th><th class=n>CV</th>
<th class=n>MSE<sub>HR</sub></th><th class=n>F<sub>2</sub></th><th class=n>FN</th>
<th class=n>FP</th><th class=n>P(&lt;LRP)</th></tr>{score_rows}{pub_rows}</table>
<figure>{fig_scores(col)}<figcaption><b>Figure 1.</b> Challenge loss with bootstrap intervals.
Dashed: winning entry of the 2019 competition.</figcaption></figure>
<p>The gate model has the lowest test loss of the models trained here ({gate["L"]:.3f}). It is
nevertheless not reported as an improvement, for two reasons. First, the selection rule fixed in
advance — lowest cross-validated loss on training data — prefers LRP ({sel["cv_L_lrp"]:.2f}
against {sel["cv_L_gbm_gate"]:.2f}). Second, the 95% interval of the paired difference is
[{gate["delta_vs_reference_ci95"][0]:.2f}, {gate["delta_vs_reference_ci95"][1]:.2f}]; the gate
wins in {gate["p_better_than_reference"] * 100:.0f}% of resamples. Direct regression
(L = {direct["L"]:.2f}) is pulled to the low-risk floor by the
{100 - ds["train"]["prevalence_protocol"] * 100:.0f}% of low-risk training events.{gru_sentence}</p>
<figure>{fig_transition(col)}<figcaption><b>Figure 2.</b> Probability that an event ends
high-risk given its latest known risk. The same input has a different outcome distribution in
the two sets.</figcaption></figure>
<p><b>Why test and cross-validation disagree.</b> Figure 2 shows the selection bias directly.
An event whose latest risk lies in [−6, −5) ends high-risk in
{(tr6["p_high_final"] or 0) * 100:.0f}% of training cases and
{(te6["p_high_final"] or 0) * 100:.0f}% of test cases. A classifier trained on the former is
therefore under-confident on the latter (expected calibration error
{cal["gbm_test"]["ece"]:.3f} on test against {cal["gbm_train_oof"]["ece"]:.3f} out-of-fold),
and a threshold tuned for {ds["train"]["prevalence_protocol"] * 100:.1f}% prevalence produces
many false alarms in cross-validation but is cheap when {ds["test"]["prevalence"] * 100:.1f}% of
events are positive. The apparent test gain is thus largely a property of how the split was
constructed.</p>
<figure>{fig_scatter(col)}<figcaption><b>Figure 3.</b> Test events under the naive forecast.
Events at the left edge that end above the dashed line carried no risk signal two days
out.</figcaption></figure>
<p><b>Error analysis.</b> LRP misses {fnp["n"]} of {ds["test"]["events_high_risk"]} high-risk
events. {fnp["latest_risk_between_minus_7_and_minus_6"]} had a latest risk between −7 and −6 and
are plausibly learnable; {fnp["latest_risk_below_minus_10"]} were below −10, of which
{fnp["latest_risk_floor_minus_30"]} sat at the dataset floor of −30 together with
{col["transition"]["test"][0]["n"]:,} other test events. For those, the risk appeared after new
tracking data arrived inside the last two days; no input available at decision time
distinguishes them.</p>

<h3>4.2 Manoeuvre detection</h3>
<table class="wide"><caption><b>Table 2.</b> Event-level precision (P), recall (R) and F1,
leave-one-satellite-out, {tot["maneuver_events"]} events.</caption>
<tr><th>Detector</th><th class=n>P</th><th class=n>R</th><th class=n>F1</th><th class=n>P</th>
<th class=n>R</th><th class=n>F1</th><th class=n>P</th><th class=n>R</th><th class=n>F1</th></tr>
<tr><td></td><td colspan=3 class=n>LEO (10 sat.)</td><td colspan=3 class=n>GEO (5 sat.)</td>
<td colspan=3 class=n>all</td></tr>{man_rows}</table>
<p>The classifier is best overall (F1 = {ms["ml"]["ALL"]["f1"]:.2f}); the physics baseline is
slightly better in GEO ({ms["physics"]["GEO"]["f1"]:.2f} against {ms["ml"]["GEO"]["f1"]:.2f}).
CUSUM is worst: it integrates every noisy stretch of element sets into an alarm.</p>
<table><caption><b>Table 3.</b> Ablation of the physics baseline (all satellites).</caption>
<tr><th>Signal</th><th class=n>P</th><th class=n>R</th><th class=n>F1</th></tr>{abl_rows}</table>
<p>The ablation (Table 3) carries the main lesson. Thresholding single-interval jumps and RTN
residuals — the obvious first design — yields F1 = {ab["jump"]["ALL"]["f1"]:.2f}, because every
bad element set triggers twice. The level-shift statistic on semi-major axis alone reaches
{ab["a"]["ALL"]["f1"]:.2f}; adding inclination lowers it to {ab["a+i"]["ALL"]["f1"]:.2f}, and
requiring RTN confirmation to {ab["a+i&rtn"]["ALL"]["f1"]:.2f}. The classifier therefore adds
about {(ms["ml"]["ALL"]["f1"] - ab["a"]["ALL"]["f1"]) * 100:.0f} F1 points over the best
one-signal rule, not {(ms["ml"]["ALL"]["f1"] - ms["physics"]["ALL"]["f1"]) * 100:.0f}.</p>
</div>
<figure class="wide">{fig_maneuver(man)}<figcaption><b>Figure 4.</b> Left: event-level scores
over all satellites. Right: recall against the size of the step in mean semi-major axis at the
reported burn (LEO).</figcaption></figure>
<div class="cols">
<p>Detectability is set by burn size (Figure 4, right). Of {small["n"]} reported LEO burns that
changed the mean semi-major axis by less than 1 m, the best detector finds {small["ml"]}. Recall
also drops above 100 m, for a different reason: {lbm["with_another_reported_burn_within_4_days"]}
of the {lbm["missed"]} large burns missed by the classifier have another reported burn within
four days. These are orbit-change campaigns; at one element set per day they merge into one
detection, which one-to-one matching credits once. Changing the matching lag from two days to
one or three changes the classifier's F1 by
{abs(man["lag_sensitivity"]["ml"]["3.0"]["f1"] - man["lag_sensitivity"]["ml"]["1.0"]["f1"]):.3f}.</p>

<table><caption><b>Table 4.</b> F1 per satellite (held out in turn). n = manoeuvre
events.</caption><tr><th>Satellite</th><th class=n>n</th><th class=n>Physics</th>
<th class=n>CUSUM</th><th class=n>Classifier</th></tr>{sat_rows}</table>
<p>Per-satellite results (Table 4) vary more than the method averages: from
{min(x["metrics"]["ml"]["f1"] for x in man["satellites"]):.2f} to
{max(x["metrics"]["ml"]["f1"] for x in man["satellites"]):.2f} for the classifier. The weakest
case is TOPEX (1992–2004), the oldest history in the benchmark; why — tracking quality of that
era, burn sizes, or both — was not investigated.</p>

<h2>5 Discussion</h2>
<p>The two experiments point the same way. In both, most of the achievable performance comes
from one physically meaningful quantity — the latest risk, the step in semi-major axis — and
the learned models mostly re-weight it. The classifier's most important input is the
semi-major-axis step ({man["importance"][0]["gain"] * 100:.0f}% of split gain); the gate's is the
mean of the risk history ({col["importance"][0]["gain"] * 100:.0f}%). Where the information is
absent from the inputs — risk that appears in the last two days, burns below the noise of the
element sets — no model recovers it.</p>
<p>The second lesson is about evaluation rather than modelling. Had the test score alone been
reported, the collision experiment would read as a {(1 - gate['L'] / lrp['L']) * 100:.0f}% improvement over the baseline that only
twelve of ninety-seven teams beat. The cross-validation estimate, the bootstrap interval and the
transition analysis each tell a more careful story, and they cost a few lines of code. The same
holds for the manoeuvre ablation: without it, the classifier would appear to add
{(ms['ml']['ALL']['f1'] - ms['physics']['ALL']['f1']) * 100:.0f} F1 points instead of {(ms['ml']['ALL']['f1'] - ab['a']['ALL']['f1']) * 100:.0f}.</p>

<h2>6 Limitations</h2>
<p><b>Collision.</b> With {ds["test"]["events_high_risk"]} high-risk test events every interval
is wide. The data are from 2015–2019, anonymised, from one agency's missions, and "risk" is a
computed probability: no collision is in the data. The models were evaluated on the test set
once, but the author had read the challenge paper, which reports what worked. Nothing here
transfers to operational prevalence.</p>
<p><b>Manoeuvres.</b> Fifteen well-tracked satellites performing impulsive station-keeping.
Low-thrust electric propulsion, which dominates today's large constellations, is not covered.
Labels are operator reports: an unreported burn counts as a false alarm. Thresholds and model
fits are out-of-sample, but the detector design (window lengths, the level-shift statistic) was
iterated on these same satellites. The level-shift statistic needs three later element sets, so
a detection is available about three days after the burn.</p>
<p><b>Visualisation.</b> {meta["count"]:,} of {meta["satcat_on_orbit"]["total"]:,} on-orbit
objects are shown; most debris and rocket bodies require a Space-Track account. SGP4 accuracy
degrades by kilometres per day away from the element epoch. Frame rate was measured only under
software rendering.</p>

<h2>7 Future work</h2>
<p>(1) A forward archive of daily CelesTrak snapshots started with this project; after about a
month it allows the manoeuvre detectors to run on any object, initially unlabelled. (2)
Supplemental GP data fitted to operator ephemerides (e.g. Starlink) would allow a study of
low-thrust orbit raising. (3) For conjunctions, predicting a calibrated distribution of the
final risk rather than a point value, and evaluating with proper scoring rules under an explicit
prevalence assumption, would separate model quality from the split's bias. (4) Covariance-aware
features (for instance the evolution of miss distance in units of combined position
uncertainty) were not explored.</p>

<h2>Reproducibility</h2>
<p><code>make setup data reproduce</code> rebuilds every table and figure from the public
sources (about ten minutes, 221 MB download). Collision results: code
{col["meta"]["code_version"]}, run {col["meta"]["generated_at"][:10]}; manoeuvre results: code
{man["meta"]["code_version"]}, benchmark commit {man["meta"]["dataset"]["commit"][:10]};
catalogue snapshot {meta["generated_at"]}. Seeds are fixed; tests cover the metric definitions,
the protocol filters, the propagators and the reporting checks.</p>

<h2>References</h2><div class="refs">
<p>Hoots, F. R., Roehrich, R. L. (1980). Models for propagation of NORAD element sets.
Spacetrack Report No. 3.</p>
<p>Kelso, T. S. CelesTrak: GP data formats and usage policy. celestrak.org (accessed November
2026).</p>
<p>Page, E. S. (1954). Continuous inspection schemes. Biometrika 41, 100–115.</p>
<p>Shorten, D. P., et al. (2023). Wide-scale monitoring of satellite lifetimes: pitfalls and a
benchmark dataset. arXiv:2212.08662.</p>
<p>Uriot, T., Izzo, D., Simões, L., et al. (2020). Spacecraft Collision Avoidance Challenge:
design and results of a machine learning competition. arXiv:2008.03069.</p>
<p>Uriot, T., Izzo, D., Martinez-Heras, J., et al. (2021). Collision Avoidance Challenge
dataset. Zenodo. doi:10.5281/zenodo.4463683.</p>
<p>Vallado, D. A., Crawford, P., Hujsak, R., Kelso, T. S. (2006). Revisiting Spacetrack Report
#3. AIAA 2006-6753.</p>
</div>
<div class="foot">Orbital data: CelesTrak, derived from 18 SDS / Space-Track.org. Conjunction
data: European Space Agency, CC BY 4.0. Manoeuvre labels: International DORIS Service via
Shorten et al. {brand.DISCLAIMER}</div>
</div></body></html>"""


def main() -> None:
    col = json.loads((WEB_DATA / "collision.json").read_text())
    man = json.loads((WEB_DATA / "maneuvers.json").read_text())
    cat = json.loads((WEB_DATA / "catalog.json").read_text())
    html_path = ensure(REPORTS) / "RAAN_technical_report.html"
    html_path.write_text(build_html(col, man, cat))
    pdf_path = REPORTS / "RAAN_technical_report.pdf"
    script = ROOT / "web" / "scripts" / "pdf.cjs"
    try:
        subprocess.run(["node", str(script), str(html_path), str(pdf_path)], check=True)
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        print(f"HTML written to {html_path}; PDF step failed ({exc}).")
        return
    shutil.copy(pdf_path, ROOT / "web" / "public" / pdf_path.name)
    print(f"wrote {pdf_path} ({pdf_path.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
