import { fmtUtc } from '../lib/format'

export const SPEEDS = [1, 10, 60, 300, 1200] as const
export const WINDOW_S = 72 * 3600

interface Props {
  anchor: number // real "now" when the page loaded (Unix s)
  simTime: number
  playing: boolean
  speed: number
  onPlay: (playing: boolean) => void
  onSpeed: (speed: number) => void
  onSeek: (t: number) => void
}

export default function TimeBar({ anchor, simTime, playing, speed, onPlay, onSpeed, onSeek }: Props) {
  const offset = Math.max(-WINDOW_S, Math.min(WINDOW_S, simTime - anchor))
  const hours = offset / 3600
  const reverse = speed < 0
  const mag = Math.abs(speed)
  return (
    <div className="timebar glass">
      <div className="timebar__row">
        <button
          className="play"
          onClick={() => onPlay(!playing)}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14">
              <rect x="2" y="1" width="3.6" height="12" rx="1" fill="currentColor" />
              <rect x="8.4" y="1" width="3.6" height="12" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14">
              <path d="M3 1.2v11.6a.6.6 0 00.92.5l8.7-5.8a.6.6 0 000-1L3.92.7A.6.6 0 003 1.2z" fill="currentColor" />
            </svg>
          )}
        </button>
        <button
          className="dir"
          aria-pressed={reverse}
          onClick={() => onSpeed(-speed)}
          title="Reverse time direction"
        >
          {reverse ? '◀ REV' : 'FWD ▶'}
        </button>
        <div className="seg seg--sm" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} aria-pressed={mag === s} onClick={() => onSpeed(reverse ? -s : s)}>
              {s}×
            </button>
          ))}
        </div>
        <div className="timebar__clock mono" aria-live="off">
          {fmtUtc(simTime)}
          <span>
            {Math.abs(hours) < 0.01 ? 'now' : `${hours > 0 ? '+' : '−'}${Math.abs(hours).toFixed(1)} h`}
          </span>
        </div>
        <button className="now" onClick={() => onSeek(Date.now() / 1000)}>
          Now
        </button>
      </div>
      <div className="timebar__scrub">
        <span className="mono">−72 h</span>
        <div className="scrub">
          <i className="scrub__now" />
          <input
            type="range"
            min={-WINDOW_S}
            max={WINDOW_S}
            step={60}
            value={offset}
            aria-label="Simulation time offset from now"
            onChange={(e) => onSeek(anchor + Number(e.target.value))}
          />
        </div>
        <span className="mono">+72 h</span>
      </div>
      <div className="timebar__note mono">
        SGP4 PROPAGATION OF PUBLISHED ELEMENTS · NOT LIVE TRACKING
      </div>
    </div>
  )
}
