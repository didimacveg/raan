// Light "laboratory" Earth: an equirectangular texture drawn from Natural Earth land polygons
// (public domain, via the world-atlas package) plus a shader with a soft day/night terminator.
import { geoEquirectangular, geoGraticule10, geoPath } from 'd3-geo'
import * as THREE from 'three'
import { feature } from 'topojson-client'
import land50 from 'world-atlas/land-50m.json'

export function makeEarthTexture(width = 4096): THREE.CanvasTexture {
  const height = width / 2
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')!
  const projection = geoEquirectangular()
    .scale(width / (2 * Math.PI))
    .translate([width / 2, height / 2])
  const path = geoPath(projection, g)

  g.fillStyle = '#f4f7fe'
  g.fillRect(0, 0, width, height)

  g.beginPath()
  path(geoGraticule10())
  g.strokeStyle = 'rgba(31, 59, 255, 0.07)'
  g.lineWidth = width / 2048
  g.stroke()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topo = land50 as any
  g.beginPath()
  path(feature(topo, topo.objects.land))
  g.fillStyle = '#dde4f6'
  g.fill()
  g.strokeStyle = '#b4c0e4'
  g.lineWidth = width / 2048
  g.stroke()

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.generateMipmaps = true
  return texture
}

export function makeEarth(texture: THREE.Texture) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uSun: { value: new THREE.Vector3(1, 0, 0) }, // world space, unit
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uSun;
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vView;
      void main() {
        vec3 base = texture2D(uMap, vUv).rgb;
        float day = smoothstep(-0.12, 0.18, dot(vWorldNormal, uSun));
        vec3 night = base * vec3(0.80, 0.84, 0.95);
        vec3 col = mix(night, base, day);
        float rim = pow(1.0 - max(dot(vWorldNormal, vView), 0.0), 3.0);
        col = mix(col, vec3(0.30, 0.62, 1.0), rim * 0.55);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  })
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), material)

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(1.09, 96, 48),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vNormal = normalize(mat3(modelMatrix) * normal);
          vView = normalize(cameraPosition - world.xyz);
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          float a = pow(max(dot(-vNormal, vView), 0.0), 2.2);
          gl_FragColor = vec4(0.12, 0.42, 1.0, a * 0.34);
        }`,
    }),
  )
  return { earth, halo, material }
}

/** Low-precision unit Sun direction in the TEME/ECI frame (Astronomical Almanac, ~0.01°). */
export function sunDirectionEci(unixSeconds: number): [number, number, number] {
  const d = unixSeconds / 86400 + 2440587.5 - 2451545.0
  const rad = Math.PI / 180
  const meanLon = (280.46 + 0.9856474 * d) * rad
  const anomaly = (357.528 + 0.9856003 * d) * rad
  const lambda = meanLon + (1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * rad
  const eps = (23.439 - 0.0000004 * d) * rad
  return [Math.cos(lambda), Math.cos(eps) * Math.sin(lambda), Math.sin(eps) * Math.sin(lambda)]
}
