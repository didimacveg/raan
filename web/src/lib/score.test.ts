import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { gated, score } from './score'

describe('challenge metric (TypeScript mirror)', () => {
  it('matches the hand-computed example used in the Python tests', () => {
    const s = score([-5, -4, -7, -30, -5.5], [-5.5, -6.5, -5, -20, -5.5])
    expect([s.tp, s.fp, s.fn, s.tn]).toEqual([2, 1, 1, 1])
    expect(s.f2).toBeCloseTo(2 / 3, 12)
    expect(s.mse_hr).toBeCloseTo((0.25 + 2.001 ** 2) / 3, 12)
    expect(score([-5, -30], [-30, -30]).L).toBe(Infinity)
  })

  const file = new URL('../../public/data/collision.json', import.meta.url)
  it.skipIf(!existsSync(file))('reproduces the pipeline results from the per-event arrays', () => {
    const d = JSON.parse(readFileSync(file, 'utf8'))
    const ev = d.events
    const byKey = Object.fromEntries(d.results.map((r: { key: string }) => [r.key, r]))
    const lrp = score(ev.true_risk, ev.latest_risk)
    expect(lrp.L).toBeCloseTo(byKey.lrp.L, 3)
    expect([lrp.fn, lrp.fp]).toEqual([byKey.lrp.fn, byKey.lrp.fp])
    const gate = score(ev.true_risk, gated(ev.gbm_prob, ev.gbm_value, byKey.gbm_gate.threshold))
    expect(gate.L).toBeCloseTo(byKey.gbm_gate.L, 2)
    expect(Math.abs(gate.fn - byKey.gbm_gate.fn)).toBeLessThanOrEqual(1) // probabilities rounded to 1e-5
  })
})
