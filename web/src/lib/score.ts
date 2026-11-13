// Collision Avoidance Challenge metric, mirrored from raan/collision/metrics.py so the page can
// recompute it live. src/lib/score.test.ts checks it against the Python numbers.
export const THRESHOLD = -6
export const CLIP_VALUE = -6.001

export interface Score {
  L: number
  mse_hr: number
  f2: number
  precision: number
  recall: number
  tp: number
  fp: number
  fn: number
  tn: number
}

export function score(truth: number[], pred: number[]): Score {
  let tp = 0
  let fp = 0
  let fn = 0
  let tn = 0
  let se = 0
  let nHr = 0
  for (let k = 0; k < truth.length; k++) {
    const p = pred[k] < THRESHOLD ? CLIP_VALUE : pred[k]
    const trueHr = truth[k] >= THRESHOLD
    const predHr = p >= THRESHOLD
    if (trueHr) {
      nHr++
      se += (truth[k] - p) ** 2
      if (predHr) tp++
      else fn++
    } else if (predHr) fp++
    else tn++
  }
  const precision = tp + fp ? tp / (tp + fp) : 0
  const recall = tp + fn ? tp / (tp + fn) : 0
  const denom = 4 * precision + recall
  const f2 = denom > 0 ? (5 * precision * recall) / denom : 0
  const mse_hr = nHr ? se / nHr : NaN
  return { L: f2 > 0 ? mse_hr / f2 : Infinity, mse_hr, f2, precision, recall, tp, fp, fn, tn }
}

/** Gate model: predicted value where the classifier probability clears the threshold. */
export const gated = (prob: number[], value: number[], tau: number) =>
  prob.map((p, k) => (p >= tau ? value[k] : CLIP_VALUE))

export type Outcome = 'tp' | 'fp' | 'fn' | 'tn'
export function outcome(truth: number, pred: number): Outcome {
  const t = truth >= THRESHOLD
  const p = pred >= THRESHOLD
  return t ? (p ? 'tp' : 'fn') : p ? 'fp' : 'tn'
}
