// WebGL engine for the orbital twin.
//
// Rendering: every catalogued object is one vertex of a single gl.POINTS draw call. The worker
// sends SGP4 key-frames; the vertex shader interpolates between two key-frames (direction and
// radius separately, so points stay on their curved path), which keeps the frame rate
// independent of how long a full-catalogue propagation takes.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Catalog } from './catalog'
import { R_EARTH } from './catalog'
import { makeEarth, makeEarthTexture, sunDirectionEci } from './earth'
import { gmst, temeToGeodetic } from './sgp4'
import type { WorkerRequest, WorkerResponse } from './worker'

const KM = 1 / R_EARTH // scene unit = one Earth radius

// Colour per object type index (order fixed by raan/catalog/classify.py OBJECT_TYPES).
export const TYPE_COLORS = ['#1f3bff', '#8791b5', '#7a3cff', '#f0288c', '#b3bad2'] as const

interface KeyFrame {
  t: number
  positions: Float32Array
}

export interface TickInfo {
  simTime: number
  fps: number
  workerMs: number
  playing: boolean
  speed: number
}

export interface LiveState {
  lat: number
  lon: number
  alt: number
  speed: number // km/s, from finite difference of the two key-frames
  radius: number
}

/**
 * Rendering quality. The engine starts at a tier chosen from the device and steps down (never
 * up) while the measured frame rate stays low. Cheapest levers first: resolution, then the
 * number of points drawn. `stride` = draw one object in every `stride`; the UI says so.
 */
export interface Quality {
  tier: number
  /** device pixels per CSS pixel actually rendered (can be below 1) */
  scale: number
  stride: number
  antialias: boolean
  /** why this tier: 'full', 'mobile', 'software renderer', 'low frame rate', 'forced' */
  reason: string
  auto: boolean
}

export type LiteMode = 'auto' | 'on' | 'off'

export interface EngineOptions {
  lite?: LiteMode
  /** deterministic frame capture (videos, posters): full quality, readable drawing buffer */
  capture?: boolean
}

const TIERS: { scale: number; stride: number }[] = [
  { scale: 2, stride: 1 }, // capped by the device pixel ratio
  { scale: 1.5, stride: 1 },
  { scale: 1, stride: 1 },
  { scale: 0.75, stride: 1 },
  { scale: 0.75, stride: 2 },
  { scale: 0.6, stride: 3 },
]
const LOW_FPS = 24 // below this for a whole window → one tier down
const ADAPT_WINDOW_MS = 1500

/** What the browser will render with, read from a throw-away context before the real one. */
export function probeDevice(): { software: boolean; mobile: boolean; renderer: string } {
  let renderer = ''
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    renderer = String((gl && ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || '')
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    /* no WebGL info: treated as an ordinary device */
  }
  const software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer)
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const mobile = coarse && Math.min(window.innerWidth, window.innerHeight) < 820
  return { software, mobile, renderer }
}

/** TEME (km) → scene coordinates (Y up, Earth radius = 1). */
const toScene = (x: number, y: number, z: number, out: THREE.Vector3) =>
  out.set(x * KM, z * KM, -y * KM)

export class GlobeEngine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 400)
  readonly controls: OrbitControls
  private readonly worker: Worker
  private readonly catalog: Catalog
  private readonly count: number

  private readonly earth: THREE.Mesh
  private readonly earthMaterial: THREE.ShaderMaterial
  private readonly points: THREE.Points
  private readonly pointsMaterial: THREE.ShaderMaterial
  private readonly attrA: THREE.BufferAttribute
  private readonly attrB: THREE.BufferAttribute
  private readonly attrVisible: THREE.BufferAttribute
  private readonly marker: THREE.Points
  private readonly orbitLine: THREE.Line
  private readonly hoverMarker: THREE.Points

  private frameA: KeyFrame | null = null
  private frameB: KeyFrame | null = null
  private queued: KeyFrame | null = null
  private pending = false
  private seq = 0
  private orbitSeq = 0
  private orbitStamp = 0

  private simTime: number
  private speed = 1
  private playing = true
  private manual = false
  private lastReal = performance.now()
  private workerMs = 0
  private fps = 60
  private frames = 0
  private fpsStamp = performance.now()
  private raf = 0
  private disposed = false
  private readonly manualWaiters = new Map<number, () => void>()

  selected: number | null = null
  private tier = 0
  private readonly maxScale: number
  private readonly antialias: boolean
  private readonly adaptive: boolean
  private qualityReason = 'full'
  private adaptFrames = 0
  private adaptStamp = 0
  private adaptHold = 0
  private lowWindows = 0
  private portrait = false
  private hovered: number | null = null
  private readonly mask: Float32Array

  onTick: (info: TickInfo) => void = () => {}
  onReady: (info: { count: number; failed: number; ms: number }) => void = () => {}
  onHover: (index: number | null, x: number, y: number) => void = () => {}
  onSelect: (index: number | null) => void = () => {}
  onQuality: (q: Quality) => void = () => {}

  constructor(
    canvas: HTMLCanvasElement,
    catalog: Catalog,
    startTime: number,
    options: EngineOptions = {},
  ) {
    this.catalog = catalog
    this.count = catalog.count
    this.simTime = startTime
    this.mask = new Float32Array(this.count).fill(1)

    // --- quality: pick a starting tier from the device, then adapt to the measured frame rate
    const capture = options.capture === true
    const lite: LiteMode = capture ? 'off' : (options.lite ?? 'auto')
    const device = probeDevice()
    this.maxScale = Math.min(window.devicePixelRatio || 1, 2)
    this.adaptive = lite !== 'off'
    if (lite === 'on') {
      this.tier = 3
      this.qualityReason = 'forced'
    } else if (lite === 'auto' && device.software) {
      this.tier = 3
      this.qualityReason = 'software renderer'
    } else if (lite === 'auto' && device.mobile) {
      this.tier = 1
      this.qualityReason = 'mobile'
    }
    // Multisampling cannot be changed after the context exists; it is the most expensive
    // setting on integrated and software GPUs, so only desktop-class starts get it.
    this.antialias = this.tier === 0

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.antialias,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: capture, // only deterministic frame capture needs to read it back
    })
    this.renderer.setPixelRatio(Math.min(TIERS[this.tier].scale, this.maxScale))
    this.renderer.setClearColor(0xffffff, 0)

    this.camera.position.set(2.9, 1.7, 3.3)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.enablePan = false
    this.controls.minDistance = 1.25
    this.controls.maxDistance = 22
    this.controls.rotateSpeed = 0.5
    this.controls.zoomSpeed = 0.7

    // A 4096-px texture is 22 MB of GPU memory with mipmaps: half the size on small devices.
    const { earth, halo, material } = makeEarth(makeEarthTexture(this.tier === 0 ? 4096 : 2048))
    this.earth = earth
    this.earthMaterial = material
    this.scene.add(earth, halo)

    // --- objects -----------------------------------------------------------------------
    const geometry = new THREE.BufferGeometry()
    this.attrA = new THREE.BufferAttribute(new Float32Array(this.count * 3).fill(NaN), 3)
    this.attrB = new THREE.BufferAttribute(new Float32Array(this.count * 3).fill(NaN), 3)
    this.attrA.setUsage(THREE.DynamicDrawUsage)
    this.attrB.setUsage(THREE.DynamicDrawUsage)
    this.attrVisible = new THREE.BufferAttribute(this.mask, 1)
    const colors = new Float32Array(this.count * 3)
    const palette = TYPE_COLORS.map((hex) => new THREE.Color(hex))
    for (let k = 0; k < this.count; k++) {
      const c = palette[catalog.cols.type[k]] ?? palette[4]
      colors.set([c.r, c.g, c.b], k * 3)
    }
    geometry.setAttribute('position', this.attrA) // three needs "position"; it is key-frame A
    geometry.setAttribute('posB', this.attrB)
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('aVisible', this.attrVisible)
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)

    this.pointsMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uMix: { value: 0 },
        uSize: { value: 2.6 },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uOpacity: { value: 0.9 },
        uStride: { value: TIERS[this.tier].stride },
      },
      vertexShader: /* glsl */ `
        attribute vec3 posB;
        attribute vec3 aColor;
        attribute float aVisible;
        uniform float uMix;
        uniform float uSize;
        uniform float uPixelRatio;
        uniform int uStride;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          bool bad = aVisible < 0.5 || position.x != position.x || posB.x != posB.x;
          bad = bad || (uStride > 1 && (gl_VertexID % uStride) != 0);
          if (bad) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
          vec3 m = mix(position, posB, uMix);
          float r = mix(length(position), length(posB), uMix);
          vec3 teme = normalize(m) * r;
          vec3 p = vec3(teme.x, teme.z, -teme.y) * ${KM.toExponential(10)};
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = -mv.z;
          gl_PointSize = max(uSize * uPixelRatio * clamp(3.4 / dist, 0.55, 2.4), 1.5);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.32, d);
          if (a < 0.02) discard;
          gl_FragColor = vec4(vColor, a * uOpacity);
          #include <colorspace_fragment>
        }`,
    })
    this.points = new THREE.Points(geometry, this.pointsMaterial)
    this.points.frustumCulled = false
    this.points.renderOrder = 2
    this.scene.add(this.points)

    // --- selection / hover markers and orbit trace -------------------------------------
    const ring = (color: string, size: number) =>
      new THREE.Points(
        new THREE.BufferGeometry().setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array(3), 3),
        ),
        new THREE.ShaderMaterial({
          transparent: true,
          depthTest: false,
          uniforms: {
            uColor: { value: new THREE.Color(color) },
            uBase: { value: size },
            uSize: { value: size * this.renderer.getPixelRatio() },
          },
          vertexShader: /* glsl */ `
            uniform float uSize;
            void main() {
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
              gl_PointSize = uSize;
            }`,
          fragmentShader: /* glsl */ `
            uniform vec3 uColor;
            void main() {
              float d = length(gl_PointCoord - 0.5) * 2.0;
              float ringA = smoothstep(0.62, 0.72, d) * smoothstep(1.0, 0.9, d);
              float dot = smoothstep(0.26, 0.16, d);
              float a = max(ringA, dot);
              if (a < 0.02) discard;
              gl_FragColor = vec4(uColor, a);
              #include <colorspace_fragment>
            }`,
        }),
      )
    this.marker = ring('#ff7a1a', 30)
    this.hoverMarker = ring('#0b1030', 20)
    for (const m of [this.marker, this.hoverMarker]) {
      m.visible = false
      m.frustumCulled = false
      m.renderOrder = 4
      this.scene.add(m)
    }
    this.orbitLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.9 }),
    )
    this.orbitLine.visible = false
    this.orbitLine.frustumCulled = false
    this.orbitLine.renderOrder = 3
    this.scene.add(this.orbitLine)

    // --- worker ------------------------------------------------------------------------
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onWorker(ev.data)
    this.post({ kind: 'init', cols: catalog.cols })

    this.resize()
    this.loop = this.loop.bind(this)
    this.raf = requestAnimationFrame(this.loop)
  }

  // ---------------------------------------------------------------------------------------
  private post(msg: WorkerRequest) {
    this.worker.postMessage(msg)
  }

  private requestFrame(t: number) {
    this.pending = true
    this.post({ kind: 'frame', seq: this.seq, t })
  }

  /** Sim-time distance between key-frames: short enough that interpolation stays accurate. */
  private span(): number {
    return Math.sign(this.speed || 1) * Math.min(Math.max(Math.abs(this.speed) * 0.6, 1), 240)
  }

  private onWorker(msg: WorkerResponse) {
    if (msg.kind === 'ready') {
      this.onReady(msg)
      this.onQuality(this.quality())
      this.resetFrames()
    } else if (msg.kind === 'frame') {
      const waiter = this.manualWaiters.get(msg.seq)
      if (msg.seq !== this.seq) return // stale (time jump happened meanwhile)
      this.pending = false
      this.workerMs = msg.ms
      const frame = { t: msg.t, positions: msg.positions }
      if (!this.frameA || !this.frameB) {
        this.frameA = frame
        this.frameB = frame
        this.upload()
      } else {
        this.queued = frame
      }
      if (waiter) {
        this.manualWaiters.delete(msg.seq)
        waiter()
      }
    } else if (msg.kind === 'orbit') {
      if (msg.seq !== this.orbitSeq || msg.index !== this.selected) return
      const pts = msg.points
      const scene = new Float32Array(pts.length)
      for (let k = 0; k < pts.length; k += 3) {
        scene[k] = pts[k] * KM
        scene[k + 1] = pts[k + 2] * KM
        scene[k + 2] = -pts[k + 1] * KM
      }
      this.orbitLine.geometry.dispose()
      this.orbitLine.geometry = new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.BufferAttribute(scene, 3),
      )
      this.orbitLine.visible = true
    }
  }

  private upload() {
    if (!this.frameA || !this.frameB) return
    ;(this.attrA.array as Float32Array).set(this.frameA.positions)
    ;(this.attrB.array as Float32Array).set(this.frameB.positions)
    this.attrA.needsUpdate = true
    this.attrB.needsUpdate = true
  }

  /** Drop all key-frames and start again at the current simulation time (after a time jump). */
  private resetFrames() {
    this.seq++
    this.frameA = this.frameB = this.queued = null
    this.requestFrame(this.simTime)
  }

  private mixFactor(): number {
    if (!this.frameA || !this.frameB || this.frameA.t === this.frameB.t) return 0
    const m = (this.simTime - this.frameA.t) / (this.frameB.t - this.frameA.t)
    return Math.min(Math.max(m, 0), 1)
  }

  private advanceFrames() {
    if (!this.frameA || !this.frameB) return
    const dir = Math.sign(this.speed || 1)
    const passedB = (this.simTime - this.frameB.t) * dir >= 0
    if (passedB && this.queued) {
      this.frameA = this.frameB
      this.frameB = this.queued
      this.queued = null
      this.upload()
    }
    if (!this.queued && !this.pending && this.playing && !this.manual) {
      this.requestFrame(this.frameB.t + this.span())
    }
  }

  // ---------------------------------------------------------------------------------------
  /** Interpolated TEME position (km) of one object at the current simulation time. */
  positionOf(index: number, out: THREE.Vector3): boolean {
    if (!this.frameA || !this.frameB) return false
    const a = this.frameA.positions
    const b = this.frameB.positions
    const k = index * 3
    if (Number.isNaN(a[k]) || Number.isNaN(b[k])) return false
    const m = this.mixFactor()
    const x = a[k] + (b[k] - a[k]) * m
    const y = a[k + 1] + (b[k + 1] - a[k + 1]) * m
    const z = a[k + 2] + (b[k + 2] - a[k + 2]) * m
    const ra = Math.hypot(a[k], a[k + 1], a[k + 2])
    const rb = Math.hypot(b[k], b[k + 1], b[k + 2])
    const s = (ra + (rb - ra) * m) / Math.hypot(x, y, z)
    out.set(x * s, y * s, z * s)
    return true
  }

  liveState(index: number): LiveState | null {
    const p = new THREE.Vector3()
    if (!this.positionOf(index, p) || !this.frameA || !this.frameB) return null
    const geo = temeToGeodetic(p.x, p.y, p.z, this.simTime)
    const a = this.frameA.positions
    const b = this.frameB.positions
    const k = index * 3
    const dt = Math.abs(this.frameB.t - this.frameA.t)
    // vis-viva from the catalogue mean elements when the key-frames coincide (paused)
    const sma = Math.cbrt(398600.8 / ((this.catalog.cols.n[index] * 2 * Math.PI) / 86400) ** 2)
    const radius = p.length()
    const visViva = Math.sqrt(398600.8 * (2 / radius - 1 / sma))
    const chord = Math.hypot(b[k] - a[k], b[k + 1] - a[k + 1], b[k + 2] - a[k + 2])
    const speed = dt > 0 && dt <= 20 ? chord / dt : visViva
    return { ...geo, speed, radius }
  }

  setMask(mask: Float32Array) {
    this.mask.set(mask)
    this.attrVisible.needsUpdate = true
    if (this.selected !== null && this.mask[this.selected] < 0.5) this.select(null)
  }

  setTime(t: number) {
    this.simTime = t
    this.resetFrames()
    this.refreshOrbit()
  }

  setSpeed(speed: number) {
    if (speed === this.speed) return
    this.speed = speed
    this.resetFrames()
  }

  setPlaying(playing: boolean) {
    this.playing = playing
    this.lastReal = performance.now()
  }

  getTime() {
    return this.simTime
  }

  select(index: number | null) {
    this.selected = index
    this.marker.visible = false
    this.orbitLine.visible = false
    if (index !== null) this.refreshOrbit()
    this.onSelect(index)
  }

  private refreshOrbit() {
    if (this.selected === null) return
    this.orbitSeq++
    this.orbitStamp = this.simTime
    this.post({
      kind: 'orbit',
      seq: this.orbitSeq,
      index: this.selected,
      t: this.simTime,
      samples: 360,
    })
  }

  /** Nearest visible, non-occluded object within `radiusPx` of a canvas-relative point. */
  pick(px: number, py: number, radiusPx = 9): number | null {
    if (!this.frameA) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    const w = rect.width
    const h = rect.height
    const cam = this.camera.position
    const p = new THREE.Vector3()
    const s = new THREE.Vector3()
    const dir = new THREE.Vector3()
    let best: number | null = null
    let bestD = radiusPx * radiusPx
    const stride = TIERS[this.tier].stride
    for (let k = 0; k < this.count; k += stride) {
      if (this.mask[k] < 0.5 || !this.positionOf(k, p)) continue
      toScene(p.x, p.y, p.z, s)
      dir.copy(s).project(this.camera)
      if (dir.z > 1) continue
      const dx = (dir.x * 0.5 + 0.5) * w - px
      const dy = (-dir.y * 0.5 + 0.5) * h - py
      const d2 = dx * dx + dy * dy
      if (d2 >= bestD) continue
      // occlusion: does the segment camera→object cross the unit sphere?
      dir.copy(s).sub(cam)
      const len = dir.length()
      dir.divideScalar(len)
      const tca = -cam.dot(dir)
      const miss2 = cam.lengthSq() - tca * tca
      if (tca > 0 && tca < len && miss2 < 1) continue
      best = k
      bestD = d2
    }
    return best
  }

  quality(): Quality {
    return {
      tier: this.tier,
      scale: this.renderer.getPixelRatio(),
      stride: TIERS[this.tier].stride,
      antialias: this.antialias,
      reason: this.qualityReason,
      auto: this.adaptive,
    }
  }

  private applyTier(tier: number, reason: string) {
    this.tier = Math.max(0, Math.min(TIERS.length - 1, tier))
    this.qualityReason = reason
    const ratio = Math.min(TIERS[this.tier].scale, this.maxScale)
    this.renderer.setPixelRatio(ratio)
    this.pointsMaterial.uniforms.uPixelRatio.value = ratio
    this.pointsMaterial.uniforms.uStride.value = TIERS[this.tier].stride
    for (const m of [this.marker, this.hoverMarker]) {
      const u = (m.material as THREE.ShaderMaterial).uniforms
      u.uSize.value = u.uBase.value * ratio
    }
    this.resize()
    this.onQuality(this.quality())
  }

  /** One tier down when a whole measurement window stays under LOW_FPS. Never steps up: a
   *  device that needed the lighter tier would only oscillate. */
  private adapt(now: number) {
    if (!this.adaptive || !this.frameA || document.hidden) {
      this.adaptFrames = 0
      this.adaptStamp = now
      return
    }
    this.adaptFrames++
    const elapsed = now - this.adaptStamp
    if (elapsed < ADAPT_WINDOW_MS) return
    const fps = (this.adaptFrames * 1000) / elapsed
    this.adaptFrames = 0
    this.adaptStamp = now
    if (this.adaptHold === 0) this.adaptHold = now + 2500 // ignore the start-up hitch
    if (now < this.adaptHold) return
    if (fps >= LOW_FPS || this.tier >= TIERS.length - 1) {
      this.lowWindows = 0
      return
    }
    this.lowWindows++
    // Lower resolution after one slow window; hide objects only if it stays slow for two.
    const dropsObjects = TIERS[this.tier + 1].stride > TIERS[this.tier].stride
    if (dropsObjects && this.lowWindows < 2) return
    this.lowWindows = 0
    this.applyTier(this.tier + 1, 'low frame rate')
    this.adaptHold = now + 1000 // let the new tier settle before judging it
  }

  setHover(index: number | null) {
    this.hovered = index
    if (index === null) this.hoverMarker.visible = false
  }

  resize() {
    const canvas = this.renderer.domElement
    const w = canvas.clientWidth || 1
    const h = canvas.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // keep the globe comfortably inside portrait viewports
    const portrait = w / h < 0.8
    this.camera.fov = portrait ? 52 : 38
    if (portrait !== this.portrait) {
      // pull back once when entering a portrait viewport so the LEO shell fits the width
      this.camera.position.multiplyScalar(portrait ? 1.3 : 1 / 1.3)
      this.portrait = portrait
    }
    this.camera.updateProjectionMatrix()
  }

  private placeMarker(marker: THREE.Points, index: number | null) {
    const p = new THREE.Vector3()
    if (index === null || !this.positionOf(index, p)) {
      marker.visible = false
      return
    }
    const attr = marker.geometry.getAttribute('position') as THREE.BufferAttribute
    attr.setXYZ(0, p.x * KM, p.z * KM, -p.y * KM)
    attr.needsUpdate = true
    marker.visible = true
  }

  private renderOnce() {
    this.advanceFrames()
    this.pointsMaterial.uniforms.uMix.value = this.mixFactor()
    this.earth.rotation.y = gmst(this.simTime)
    const [sx, sy, sz] = sunDirectionEci(this.simTime)
    this.earthMaterial.uniforms.uSun.value.set(sx, sz, -sy)
    this.placeMarker(this.marker, this.selected)
    this.placeMarker(this.hoverMarker, this.hovered === this.selected ? null : this.hovered)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  private loop(now: number) {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    if (this.manual) return
    const dt = Math.min((now - this.lastReal) / 1000, 0.25)
    this.lastReal = now
    if (this.playing) this.simTime += dt * this.speed
    if (this.selected !== null && Math.abs(this.simTime - this.orbitStamp) > 900) {
      this.refreshOrbit()
    }
    this.renderOnce()
    this.adapt(now)
    this.frames++
    if (now - this.fpsStamp >= 500) {
      this.fps = (this.frames * 1000) / (now - this.fpsStamp)
      this.frames = 0
      this.fpsStamp = now
      this.onTick({
        simTime: this.simTime,
        fps: this.fps,
        workerMs: this.workerMs,
        playing: this.playing,
        speed: this.speed,
      })
    }
  }

  /** Point diameter in CSS pixels at the reference distance (larger for posters and videos). */
  setPointSize(px: number) {
    this.pointsMaterial.uniforms.uSize.value = px
  }

  // --- deterministic capture (used by scripts/capture to render videos frame by frame) -----
  setManual(manual: boolean) {
    this.manual = manual
    this.lastReal = performance.now()
  }

  /** Propagate exactly at `t`, render one frame, resolve when it is on screen. */
  async renderAt(t: number): Promise<void> {
    this.simTime = t
    this.seq++
    this.frameA = this.frameB = this.queued = null
    const seq = this.seq
    await new Promise<void>((resolve) => {
      this.manualWaiters.set(seq, resolve)
      this.requestFrame(t)
    })
    if (this.selected !== null) {
      this.refreshOrbit()
      await new Promise((r) => setTimeout(r, 0))
    }
    this.renderOnce()
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.worker.terminate()
    this.controls.dispose()
    this.renderer.dispose()
  }
}
