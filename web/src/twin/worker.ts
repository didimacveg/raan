/// <reference lib="webworker" />
// SGP4 propagation worker. Keeps one satellite record per object and answers two requests:
//   frame — TEME positions of every object at one instant (Float32Array, transferred);
//   orbit — one revolution of a single object, sampled uniformly in time.
import type { CatalogCols } from './catalog'
import { propagateInto, satrecFromCols, type SatRec } from './sgp4'

export type WorkerRequest =
  | { kind: 'init'; cols: CatalogCols }
  | { kind: 'frame'; seq: number; t: number }
  | { kind: 'orbit'; seq: number; index: number; t: number; samples: number }

export type WorkerResponse =
  | { kind: 'ready'; count: number; failed: number; ms: number }
  | { kind: 'frame'; seq: number; t: number; positions: Float32Array; ms: number }
  | { kind: 'orbit'; seq: number; index: number; points: Float32Array }

let recs: (SatRec | null)[] = []
let epochs: number[] = []
let periods: number[] = []

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data
  if (msg.kind === 'init') {
    const t0 = performance.now()
    const n = msg.cols.id.length
    recs = new Array(n)
    epochs = msg.cols.epoch
    periods = msg.cols.n.map((revDay) => 86400 / revDay)
    let failed = 0
    for (let k = 0; k < n; k++) {
      recs[k] = satrecFromCols(msg.cols, k)
      if (!recs[k]) failed++
    }
    ctx.postMessage({ kind: 'ready', count: n, failed, ms: performance.now() - t0 })
  } else if (msg.kind === 'frame') {
    const t0 = performance.now()
    const positions = new Float32Array(recs.length * 3)
    for (let k = 0; k < recs.length; k++) {
      const rec = recs[k]
      if (rec) propagateInto(rec, epochs[k], msg.t, positions, k * 3)
      else positions[k * 3] = positions[k * 3 + 1] = positions[k * 3 + 2] = NaN
    }
    const out: WorkerResponse = {
      kind: 'frame',
      seq: msg.seq,
      t: msg.t,
      positions,
      ms: performance.now() - t0,
    }
    ctx.postMessage(out, [positions.buffer])
  } else if (msg.kind === 'orbit') {
    const rec = recs[msg.index]
    const points = new Float32Array((msg.samples + 1) * 3)
    if (rec) {
      const period = periods[msg.index]
      for (let s = 0; s <= msg.samples; s++) {
        propagateInto(rec, epochs[msg.index], msg.t + (s / msg.samples) * period, points, s * 3)
      }
    }
    ctx.postMessage({ kind: 'orbit', seq: msg.seq, index: msg.index, points }, [points.buffer])
  }
}
