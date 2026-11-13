// 見た目。course の一覧（当たりと同じデータ）から塔・棚・掛け点・仕掛けを作る。
// 遊ぶ面は半径 TOWER_R の円柱。2次元の (x, y, z) は「周に沿った距離・高さ・外向きのずれ」
import * as THREE from 'three'
import { TOWER_R } from './course.js'
import { anchorPos, hazardGeo, gustAt, floodLevel, bellK, solidAt, PH } from './physics.js'

export const PAL = { sand: 0xdda675, sandM: 0xb0825d, shadow: 0x7e5c41, deep: 0x57391e, haze: 0x909eba, cloud: 0xd0cfd8, sky: 0x557198 }
const R = TOWER_R
export const WALL_R = R - 1.7      // 塔の壁の面

// 2次元 → 3次元
export function to3(x, y, z = 0, out = new THREE.Vector3()) {
  const f = x / R, r = R + z
  return out.set(Math.sin(f) * r, y, Math.cos(f) * r)
}
export function frame(x) { const f = x / R; return { n: new THREE.Vector3(Math.sin(f), 0, Math.cos(f)), t: new THREE.Vector3(Math.cos(f), 0, -Math.sin(f)) } }

// ---------------------------------------------------------------- 質感
const TL = new THREE.TextureLoader()
let ANISO = 4
export function setAniso(a) { ANISO = a }
const texCache = new Map()
function tex(name, srgb) {
  if (texCache.has(name)) return texCache.get(name)
  const t = TL.load('assets/tex/' + name + '.webp')
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ANISO
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  texCache.set(name, t)
  return t
}
function pbr(base, o = {}) {
  return new THREE.MeshStandardMaterial({
    map: tex(base + '_diff', true), normalMap: tex(base + '_nor'), roughnessMap: tex(base + '_rough'),
    normalScale: new THREE.Vector2(o.ns ?? 1.2, o.ns ?? 1.2), roughness: o.rough ?? 1, metalness: o.metal ?? 0, color: new THREE.Color(o.color ?? 0xffffff),
  })
}
export const MAT = {}
function makeMats() {
  if (MAT.wall) return
  MAT.wall = pbr('large_sandstone_blocks_01', { color: 0xffd9a6, ns: 1.5 })
  MAT.stone = pbr('large_sandstone_blocks_01', { color: 0xf0c995, ns: 1.6 })
  MAT.trim = pbr('old_sandstone_02', { color: 0xe9d3b4, ns: 1.0 })
  MAT.recess = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 })
  MAT.moss = pbr('mossy_sandstone', { color: 0xf0e0c0 })
  MAT.rock = pbr('cliff_side', { color: 0xe8c9a0 })
  MAT.wood = pbr('medieval_wood', { color: 0xd8b892 })
  MAT.iron = pbr('green_metal_rust', { color: 0x9a8a78, metal: 0.55, rough: 0.9, ns: 0.8 })
  MAT.ironDark = new THREE.MeshStandardMaterial({ color: 0x2c2620, metalness: 0.85, roughness: 0.45 })
  MAT.rust = new THREE.MeshStandardMaterial({ color: 0x8a4a26, metalness: 0.5, roughness: 0.8 })
  MAT.bronze = new THREE.MeshStandardMaterial({ color: 0x9a7038, metalness: 0.9, roughness: 0.35 })
  MAT.crack = pbr('old_sandstone_02', { color: 0xc9a07a })
  MAT.rope = new THREE.MeshStandardMaterial({ color: 0x3a3632, metalness: 0.7, roughness: 0.4 })
  MAT.cloth = new THREE.MeshStandardMaterial({ color: 0xc9a85a, roughness: 0.95, side: THREE.DoubleSide })
}

// ---------------------------------------------------------------- 曲げた箱
// 2次元の箱 (cx,cy,w,h,角度) を、外向き z0..z1 の厚みで円柱に沿って曲げる。UV は世界の m 単位（貼り目がそろう）
function bentBox(cx, cy, w, h, a, z0, z1, uvs = 0.33) {
  const sx = Math.max(1, Math.ceil(w / 1.5))
  const g = new THREE.BoxGeometry(w, h, z1 - z0, sx, 1, 1)
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv
  const ca = Math.cos(a), sa = Math.sin(a)
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i), ly = pos.getY(i), lz = pos.getZ(i) + (z0 + z1) / 2
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i)
    const x = cx + lx * ca - ly * sa, y = cy + lx * sa + ly * ca
    // 面の向きで UV を決める（m 単位）
    if (Math.abs(nz) > 0.5) uv.setXY(i, x * uvs, y * uvs)
    else if (Math.abs(ny) > 0.5) uv.setXY(i, x * uvs, lz * uvs)
    else uv.setXY(i, lz * uvs, y * uvs)
    to3(x, y, lz, v); pos.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  return g
}

// ---------------------------------------------------------------- 世界
export class View {
  constructor(scene, W, opt = {}) {
    makeMats()
    this.scene = scene; this.W = W; this.lowEnd = !!opt.lowEnd
    this.root = new THREE.Group(); scene.add(this.root)
    this.dyn = []
    this.buildTower()
    this.buildVines()
    this.buildSolids()
    this.buildAnchors()
    this.buildHazards()
    this.buildFlags()
    this.buildGusts()
    this.buildFloods()
    this.buildRope()
    this.buildMarks()
  }

  buildTower() {
    const C = this.W.course
    const ys = C.anchors.map(a => a.y)
    const yTop = Math.max(...ys) + 60, yBot = -60
    this.yTop = yTop
    const H = yTop - yBot
    const g = new THREE.CylinderGeometry(WALL_R, WALL_R, H, 256, Math.ceil(H / 6), true)
    const uv = g.attributes.uv, pos = g.attributes.position
    for (let i = 0; i < uv.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i)
      const ang = Math.atan2(x, z)
      uv.setXY(i, ang * WALL_R / 6.5, (y + H / 2 + yBot) / 6.5)
    }
    const m = new THREE.Mesh(g, MAT.wall)
    m.position.y = yBot + H / 2
    m.receiveShadow = true; m.castShadow = false
    this.root.add(m); this.wall = m
    // 段ごとに違う飾り（同じ物を等間隔に並べない）。どれも遊ぶ面より奥なので当たりはない
    const prof = []
    const P = (r, y) => prof.push(new THREE.Vector2(WALL_R + r * 0.42, y * 0.7))
    P(-0.05, -0.55); P(0.35, -0.5); P(0.45, -0.3); P(0.75, -0.2); P(0.8, 0.05); P(1.05, 0.12); P(1.1, 0.35); P(0.6, 0.42); P(-0.05, 0.45)
    const band = new THREE.LatheGeometry(prof, 256)
    const uvb = band.attributes.uv; for (let i = 0; i < uvb.count; i++) uvb.setX(i, uvb.getX(i) * 2 * Math.PI * WALL_R / 4)
    const rnd = mulberry(7)
    const arches = [], slits = [], pil = []
    for (let y = -36, k = 0; y < yTop - 20; k++) {
      const tier = 10 + Math.floor(rnd() * 3) * 4          // 10〜18m の段
      const b = new THREE.Mesh(band, MAT.trim); b.position.y = y; b.receiveShadow = true; b.castShadow = true; this.root.add(b)
      const kind = k % 4 === 0 ? 'arcade' : ['arcade', 'slits', 'plain', 'pilaster'][Math.floor(rnd() * 4)]
      const n = kind === 'arcade' ? 34 + Math.floor(rnd() * 3) * 6 : 18 + Math.floor(rnd() * 3) * 4
      const off = rnd()
      for (let i = 0; i < n; i++) {
        const x = (i + off) * (2 * Math.PI * R / n)
        if (kind === 'arcade') arches.push([x, y + 0.6, 0.9 + (k % 2) * 0.25])
        else if (kind === 'slits' && rnd() < 0.85) slits.push([x, y + tier * 0.35, 1])
        else if (kind === 'pilaster') pil.push([x, y, tier])
      }
      y += tier
    }
    const put = (geo, mat, list, sc) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length)
      const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), pp = new THREE.Vector3(), ss = new THREE.Vector3()
      list.forEach(([x, y, k], i) => { const f = x / R; pp.set(Math.sin(f) * (WALL_R - 0.02), y, Math.cos(f) * (WALL_R - 0.02)); qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f); sc(ss, k); mm.compose(pp, qq, ss); im.setMatrixAt(i, mm) })
      im.receiveShadow = true; im.castShadow = false
      this.root.add(im)
    }
    const ag = this.archGeo()
    put(ag.frame, MAT.trim, arches, (v, k) => v.set(k, k, 1))
    put(ag.hole, MAT.recess, arches, (v, k) => v.set(k, k, 1))
    put(ag.hole, MAT.recess, slits, (v) => v.set(0.32, 0.9, 1))
    put(new THREE.BoxGeometry(1.1, 1, 0.3).translate(0, 0.5, 0.1), MAT.stone, pil, (v, k) => v.set(1, k, 1))
  }
  archGeo() {
    // 壁に浅く彫ったアーチ: 枠（石）と奥（暗い）を別に
    const w = 1.5, h = 3.2, iw = 1.1, ih = 3.0
    const s = new THREE.Shape()
    s.moveTo(-w, -0.3); s.lineTo(-w, h); s.absarc(0, h, w, Math.PI, 0, true); s.lineTo(w, -0.3); s.lineTo(-w, -0.3)
    const holeShape = () => { const q = new THREE.Path(); q.moveTo(-iw, 0); q.lineTo(iw, 0); q.lineTo(iw, ih); q.absarc(0, ih, iw, 0, Math.PI, false); q.lineTo(-iw, 0); return q }
    s.holes.push(holeShape())
    const frame = new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 1, curveSegments: 10 })
    const uv = frame.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.3, uv.getY(i) * 0.3)
    const q = new THREE.Shape(); q.moveTo(-iw, 0); q.lineTo(iw, 0); q.lineTo(iw, ih); q.absarc(0, ih, iw, 0, Math.PI, false); q.lineTo(-iw, 0)
    const hole = new THREE.ShapeGeometry(q, 8); hole.translate(0, 0, 0.03)
    return { frame, hole }
  }

  buildVines() {
    // ツタ（描いた4本の束を板に貼る）。壁から少し浮かせ、遊ぶ面より奥
    const tx = new THREE.TextureLoader().load('assets/vines.webp'); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = ANISO
    const rnd = mulberry(31)
    const n = this.lowEnd ? 90 : 170
    const per = [[], [], [], []]
    for (let i = 0; i < n; i++) {
      const x = rnd() * 2 * Math.PI * R, y = -20 + rnd() * (this.yTop - 30)
      per[Math.floor(rnd() * 4)].push([x, y, 4 + rnd() * 6, (rnd() - 0.5) * 0.15])
    }
    per.forEach((list, k) => {
      const t = tx.clone(); t.repeat.set(0.25, 1); t.offset.set(k * 0.25, 0); t.needsUpdate = true
      const mat = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, color: 0xd8e2b0 })
      const geo = new THREE.PlaneGeometry(1.6, 1).translate(0, -0.5, 0)
      const im = new THREE.InstancedMesh(geo, mat, list.length)
      const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), pp = new THREE.Vector3(), ss = new THREE.Vector3()
      list.forEach(([x, y, h, rot], i) => { const f = x / R; pp.set(Math.sin(f) * (WALL_R + 0.12), y, Math.cos(f) * (WALL_R + 0.12)); qq.setFromEuler(new THREE.Euler(0, f, rot)); ss.set(1.1, h, 1); mm.compose(pp, qq, ss); im.setMatrixAt(i, mm) })
      im.castShadow = true; im.receiveShadow = true
      im.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: t, alphaTest: 0.45 })
      this.root.add(im)
    })
  }

  buildSolids() {
    for (const s of this.W.solids) {
      const mat = s.mat === 'stone' ? MAT.moss : (MAT[s.mat] || MAT.stone)
      const z0 = WALL_R - R - 0.4, z1 = s.perch ? 0.7 : s.mat === 'wood' ? 0.8 : 0.9
      const g = bentBox(s.x, s.y, s.w, s.h, s.a || 0, z0, z1)
      const m = new THREE.Mesh(g, mat)
      m.castShadow = true; m.receiveShadow = true
      this.root.add(m)
      if (s.bell) this.dyn.push({ k: 'solid', s, m, base: g })
      // 木の床は下に支えの梁を足す
      if (s.mat === 'wood') {
        for (let x = s.x - s.w / 2 + 1; x < s.x + s.w / 2; x += 3) {
          const bg = bentBox(x, s.y - s.h / 2 - 0.9, 0.35, 0.35, 0, z0, z1 - 0.3)
          const bm = new THREE.Mesh(bg, MAT.wood); bm.castShadow = true; this.root.add(bm)
        }
      }
    }
  }

  buildAnchors() {
    this.anchorMeshes = []
    const ringG = new THREE.TorusGeometry(0.42, 0.075, 10, 28)
    const boltG = new THREE.CylinderGeometry(0.12, 0.12, 0.5, 10)
    const glowG = new THREE.RingGeometry(0.5, 0.6, 40)
    for (const a of this.W.anchors) {
      const g = new THREE.Group()
      const kind = a.kind
      // 台座（壁から突き出た石の持ち送り）
      const bz0 = WALL_R - R - 0.2, bz1 = -0.35
      // 台座の形は3種（石の持ち送り・木の梁・鉄の腕）。崩れる点はいつもひびの入った石
      const style = kind === 'crumble' ? 0 : ((a.i * 7 + 3) % 10 < 6 ? 0 : (a.i * 7 + 3) % 10 < 9 ? 1 : 2)
      let base
      if (style === 0) base = new THREE.Mesh(bentBox(a.x, a.y + 0.15, 1.0, 0.8, 0, bz0, bz1), kind === 'crumble' ? MAT.crack : MAT.stone)
      else if (style === 1) base = new THREE.Mesh(bentBox(a.x, a.y + 0.6, 0.34, 0.34, 0, bz0, 0.12), MAT.wood)
      else base = new THREE.Mesh(bentBox(a.x, a.y + 0.45, 0.16, 0.22, 0, bz0, 0.05), MAT.iron)
      base.castShadow = true; base.receiveShadow = true
      if (!a.move) this.root.add(base)
      const ring = new THREE.Mesh(ringG, kind === 'rusty' ? MAT.rust : MAT.ironDark)
      ring.castShadow = true
      g.add(ring)
      const bolt = new THREE.Mesh(boltG, MAT.ironDark); bolt.rotation.x = Math.PI / 2; bolt.position.z = -0.3; g.add(bolt)
      if (kind === 'bell') {
        const bell = new THREE.Mesh(new THREE.LatheGeometry([[0, 0.9], [0.18, 0.88], [0.3, 0.6], [0.38, 0.2], [0.55, -0.15], [0.6, -0.22], [0.0, -0.22]].map(p => new THREE.Vector2(p[0], p[1])), 20), MAT.bronze)
        bell.position.y = -1.1; bell.castShadow = true; g.add(bell)
      }
      if (a.move) {
        // 動く点はレール付き
        const m = a.move
        if (m.k === 'line') {
          const p0 = { x: a.x - m.dx, y: a.y - m.dy }, p1 = { x: a.x + m.dx, y: a.y + m.dy }
          const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) + 1.4
          const rail = new THREE.Mesh(bentBox(a.x, a.y + 0.55, len, 0.22, Math.atan2(m.dy, m.dx), bz0, -0.5), MAT.iron)
          rail.castShadow = true; this.root.add(rail)
        }
      }
      this.root.add(g)
      // 光る輪（届く点）
      const glow = new THREE.Mesh(glowG, new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
      g.add(glow)
      this.anchorMeshes.push({ a, g, ring, base, glow, fall: 0 })
    }
  }

  buildHazards() {
    this.hz = []
    for (const h of this.W.hazards) {
      const g = new THREE.Group()
      if (h.k === 'blade') {
        // 木の羽根（題材の物: 古い風車の羽根）
        for (let k = 0; k < h.n; k++) {
          const arm = new THREE.Group()
          const spar = new THREE.Mesh(new THREE.BoxGeometry(h.len, 0.22, 0.22), MAT.wood); spar.position.x = h.len / 2; arm.add(spar)
          const sail = new THREE.Mesh(new THREE.BoxGeometry(h.len * 0.78, h.hw * 2 + 0.5, 0.08), MAT.wood); sail.position.set(h.len * 0.58, h.hw + 0.2, 0.08); arm.add(sail)
          arm.rotation.z = k * Math.PI * 2 / h.n
          spar.castShadow = sail.castShadow = true
          g.add(arm)
        }
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.8, 16), MAT.iron); hub.rotation.x = Math.PI / 2; g.add(hub)
      } else if (h.k === 'ball') {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(h.r, 24, 16), MAT.iron); ball.castShadow = true; ball.name = 'ball'
        g.add(ball)
        const links = new THREE.Group(); links.name = 'chain'
        const lg = new THREE.TorusGeometry(0.16, 0.05, 6, 10)
        const n = Math.ceil(h.L / 0.26)
        for (let i = 0; i < n; i++) { const l = new THREE.Mesh(lg, MAT.ironDark); l.position.y = -i * 0.26; l.rotation.y = i % 2 ? Math.PI / 2 : 0; links.add(l) }
        g.add(links)
      } else if (h.k === 'piston') {
        const ram = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), MAT.stone); ram.castShadow = true; ram.name = 'ram'; g.add(ram)
      }
      this.root.add(g)
      this.hz.push({ h, g })
    }
  }

  buildFlags() {
    this.flagMeshes = []
    for (const f of this.W.flags) {
      const g = new THREE.Group()
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 3.4, 8), MAT.wood); pole.position.y = 1.7; pole.castShadow = true; g.add(pole)
      const cg = new THREE.PlaneGeometry(1.7, 1.0, 12, 6); cg.translate(0.85, 0, 0)
      const cm = MAT.cloth.clone(); cm.map = bannerTex(); cm.alphaTest = 0.5; cm.color.set(0xffffff)
      const cloth = new THREE.Mesh(cg, cm); cloth.position.y = 2.75; cloth.castShadow = true; g.add(cloth)
      cloth.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: cm.map, alphaTest: 0.5 })
      to3(f.x - 1.05, f.y, 0.1, g.position); g.rotation.y = (f.x - 1.05) / R
      this.root.add(g)
      this.flagMeshes.push({ f, g, cloth, base: cg.attributes.position.array.slice() })
    }
  }

  buildGusts() {
    // 突風: 砂ぼこりの筋（吹いている間だけ見える）
    this.gustFx = []
    const tex = streakTexture()
    for (const gs of this.W.gusts) {
      const n = this.lowEnd ? 18 : 40
      const geo = new THREE.PlaneGeometry(1, 1)
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xf1d7a8, transparent: true, opacity: 0, depthWrite: false })
      const mesh = new THREE.InstancedMesh(geo, mat, n)
      const seeds = Array.from({ length: n }, (_, i) => ({ u: frac(Math.sin(i * 12.9898) * 43758.5), v: frac(Math.sin(i * 78.233) * 12345.6), z: frac(Math.sin(i * 3.1) * 999) }))
      this.root.add(mesh)
      this.gustFx.push({ gs, mesh, seeds })
    }
  }

  buildFloods() {
    // 下から満ちる砂。上の面は細かく波打つ
    this.floodFx = []
    const sandMat = pbr('cliff_side', { color: 0xf2c88c, ns: 0.8 })
    for (let i = 0; i < this.W.floods.length; i++) {
      const f = this.W.floods[i]
      const g = bentBox((f.x0 + f.x1) / 2, -20, f.x1 - f.x0 + 8, 40, 0, WALL_R - R - 0.5, 2.2, 0.25)
      const m = new THREE.Mesh(g, sandMat); m.receiveShadow = true
      this.root.add(m)
      this.floodFx.push({ f, i, m })
    }
  }

  buildRope() {
    this.rope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6, 1), MAT.rope)
    this.rope.castShadow = true
    this.rope.visible = false
    this.root.add(this.rope)
    // 狙っているが届かない時の点線
    const dg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)])
    this.aimLine = new THREE.Line(dg, new THREE.LineDashedMaterial({ color: 0xfff2d0, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.8, depthTest: false }))
    this.aimLine.visible = false; this.aimLine.renderOrder = 10
    this.root.add(this.aimLine)
  }

  buildMarks() {
    // 狙っている点の印（画面に向く輪）
    const t = ringTexture()
    this.aimMark = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, color: 0xffe6a8, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }))
    this.aimMark.scale.set(1.9, 1.9, 1); this.aimMark.renderOrder = 11; this.aimMark.visible = false
    this.root.add(this.aimMark)
  }

  // 毎コマ
  update(S, ui, dt, camera) {
    const W = this.W, t = S.t
    const q = { x: 0, y: 0 }
    const grab = new Set(ui.grabbable || [])
    for (const am of this.anchorMeshes) {
      const a = am.a, st = S.an[a.i]
      anchorPos(W, S, a, q)
      const gone = (a.kind === 'rusty' && st.used) || st.back > 0
      const fallT = st.fallT
      to3(q.x, q.y, 0, am.g.position)
      am.g.rotation.set(0, q.x / R, 0)
      // 崩れる点はぐらつく
      if (a.kind === 'crumble' && st.crT >= 0 && fallT === 0) { const k = st.crT * 30; am.g.position.y += Math.sin(k) * 0.04; am.base.position.y = Math.sin(k * 1.3) * 0.05 }
      else am.base.position.y = 0
      if (fallT > 0) { am.base.position.y = -0.5 * 20 * fallT * fallT; am.base.rotation.z = fallT * 0.8 }
      else am.base.rotation.z = 0
      am.base.visible = !(st.back > 0)
      am.g.visible = !gone && !(a.hidden && bellK(S, a.hidden.g) < 0.5)
      // 光り方: 狙っている点 > 届く点 > 届かない点
      const inR = grab.has(a.i)
      const hot = ui.hover === a.i || ui.target === a.i
      const want = !am.g.visible ? 0 : hot ? 1.6 : inR ? 0.9 + 0.35 * Math.sin(t * 5 + a.i) : 0
      am.glow.material.opacity += (Math.min(1, want) - am.glow.material.opacity) * Math.min(1, dt * 12)
      am.glow.scale.setScalar(hot ? 1.5 : 1.15)
      am.glow.material.color.setRGB(...(hot && !inR ? [0.8, 0.8, 0.8] : hot ? [2.2, 1.5, 0.6] : [1.4, 0.95, 0.4]))
      am.glow.position.z = 0.1
    }
    // 仕掛け
    for (const o of this.hz) {
      const h = o.h, G = hazardGeo(h, t)
      if (h.k === 'blade') { to3(h.x, h.y, 0.3, o.g.position); o.g.rotation.set(0, h.x / R, G.ang) }
      else if (h.k === 'ball') {
        to3(h.x, h.y, 0, o.g.position); o.g.rotation.set(0, h.x / R, G.th)
        const ball = o.g.getObjectByName('ball'); ball.position.set(0, -h.L, 0)
      } else if (h.k === 'piston') {
        const ram = o.g.getObjectByName('ram')
        to3(h.x, h.y, 0, o.g.position); o.g.rotation.set(0, h.x / R, Math.atan2(h.dy, h.dx))
        const len = Math.hypot(h.dx, h.dy) * G.k + 0.6
        ram.scale.set(len, h.hw * 2, 1.6); ram.position.x = len / 2 - 0.3
      }
    }
    // 砂の高さ
    for (const fx of this.floodFx) { const lv = floodLevel(W, S, fx.i); fx.m.position.y = lv + Math.sin(t * 2) * 0.05 }
    // 鐘で動く壁
    for (const d of this.dyn) {
      if (d.k !== 'solid') continue
      const b = solidAt(W, S, d.s)
      const dx = b.x - d.s.x, dy = b.y - d.s.y
      d.m.position.y = dy
      d.m.rotation.y = dx / R
    }
    // 旗のはためき
    for (const fm of this.flagMeshes) {
      const p = fm.cloth.geometry.attributes.position
      for (let i = 0; i < p.count; i++) {
        const x = fm.base[i * 3], y = fm.base[i * 3 + 1]
        p.setZ(i, Math.sin(x * 2.6 - t * 6 + y) * 0.12 * x)
        p.setY(i, y - x * x * 0.05)
      }
      p.needsUpdate = true; fm.cloth.geometry.computeVertexNormals()
    }
    // 突風の筋
    for (const gf of this.gustFx) {
      const gs = gf.gs, k = gustAt(gs, t)
      gf.mesh.material.opacity = 0.55 * k
      const m = new THREE.Matrix4(), pos = new THREE.Vector3(), qq = new THREE.Quaternion(), sc = new THREE.Vector3()
      const dir = Math.sign(gs.fx) || 1
      gf.seeds.forEach((s, i) => {
        const span = gs.x1 - gs.x0
        const x = gs.x0 + frac(s.u + t * 0.9 * dir * 18 / span) * span
        const y = gs.y0 + s.v * (gs.y1 - gs.y0)
        to3(x, y, -0.8 + s.z * 3, pos)
        qq.setFromEuler(new THREE.Euler(0, x / R, 0))
        sc.set(2.5 + s.z * 3, 0.12 + s.z * 0.1, 1)
        m.compose(pos, qq, sc); gf.mesh.setMatrixAt(i, m)
      })
      gf.mesh.instanceMatrix.needsUpdate = true
    }
    // ワイヤー
    if (S.rope && ui.hand) {
      const a = W.anchors[S.rope.i]
      anchorPos(W, S, a, q)
      const p0 = ui.hand, p1 = to3(q.x, q.y, 0)
      const mid = p0.clone().add(p1).multiplyScalar(0.5)
      const len = p0.distanceTo(p1)
      this.rope.visible = true
      this.rope.position.copy(mid)
      this.rope.scale.set(1, len, 1)
      this.rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize())
    } else this.rope.visible = false
    // 狙い（押している点が届かない間は点線）
    const tg = ui.target
    if (tg != null && tg >= 0 && !(S.rope && S.rope.i === tg)) {
      anchorPos(W, S, W.anchors[tg], q)
      const p1 = to3(q.x, q.y, 0.3)
      this.aimLine.visible = true
      const pa = this.aimLine.geometry.attributes.position
      const p0 = to3(S.p.x, S.p.y + 0.4, 0.3)
      pa.setXYZ(0, p0.x, p0.y, p0.z); pa.setXYZ(1, p1.x, p1.y, p1.z); pa.needsUpdate = true
      this.aimLine.computeLineDistances()
      this.aimMark.visible = true; this.aimMark.position.copy(p1)
      this.aimMark.material.opacity = 0.6 + 0.4 * Math.sin(t * 14)
    } else { this.aimLine.visible = false; this.aimMark.visible = false }
  }
}

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
let _banner = null
function bannerTex() {
  if (_banner) return _banner
  // 黄ばんだ布: しみ・日焼けの濃淡・裾のほつれ。真ん中に褪せた赤の鉤の印
  const c = document.createElement('canvas'); c.width = 256; c.height = 160
  const x = c.getContext('2d')
  const g = x.createLinearGradient(0, 0, 256, 160); g.addColorStop(0, '#e2c886'); g.addColorStop(1, '#b6944f')
  x.fillStyle = g; x.fillRect(0, 0, 256, 160)
  const r = mulberry(5)
  for (let i = 0; i < 70; i++) { x.fillStyle = `rgba(${90 + r() * 40},${60 + r() * 30},${30},${0.04 + r() * 0.06})`; x.beginPath(); x.ellipse(r() * 256, r() * 160, 4 + r() * 26, 3 + r() * 14, r() * 3, 0, 7); x.fill() }
  x.strokeStyle = 'rgba(140,48,34,0.75)'; x.lineWidth = 9; x.lineCap = 'round'
  x.beginPath(); x.moveTo(128, 30); x.lineTo(128, 92); x.stroke()
  x.beginPath(); x.arc(128, 108, 18, Math.PI * 1.1, Math.PI * 0.05, true); x.stroke()
  // 裾と先のほつれ（透明に切る）
  x.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 26; i++) { const px = 140 + r() * 116, w = 3 + r() * 9, h = 10 + r() * 40; x.beginPath(); x.moveTo(px, 160); x.lineTo(px + w, 160 - h); x.lineTo(px + w * 2, 160); x.fill() }
  for (let i = 0; i < 16; i++) { const py = r() * 160, h = 3 + r() * 10, w = 8 + r() * 30; x.beginPath(); x.moveTo(256, py); x.lineTo(256 - w, py + h); x.lineTo(256, py + h * 2); x.fill() }
  _banner = new THREE.CanvasTexture(c); _banner.colorSpace = THREE.SRGBColorSpace
  return _banner
}
function frac(v) { return v - Math.floor(v) }
function streakTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 16
  const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 128, 0)
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = g; x.fillRect(0, 5, 128, 6)
  return new THREE.CanvasTexture(c)
}
function ringTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const x = c.getContext('2d')
  x.strokeStyle = 'rgba(0,0,0,0.55)'; x.lineWidth = 12; x.beginPath(); x.arc(64, 64, 46, 0, Math.PI * 2); x.stroke()
  x.strokeStyle = '#fff'; x.lineWidth = 6; x.beginPath(); x.arc(64, 64, 46, 0, Math.PI * 2); x.stroke()
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; x.beginPath(); x.moveTo(64 + Math.cos(a) * 54, 64 + Math.sin(a) * 54); x.lineTo(64 + Math.cos(a) * 64, 64 + Math.sin(a) * 64); x.lineWidth = 6; x.stroke() }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
}
export function mergeGeos(list) {
  // 位置・法線・UV だけの簡単なまとめ
  const gs = list.map(g => g.index ? g.toNonIndexed() : g)
  let n = 0; for (const g of gs) n += g.attributes.position.count
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2)
  let o = 0
  for (const g of gs) {
    if (!g.attributes.normal) g.computeVertexNormals()
    P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3)
    if (g.attributes.uv) U.set(g.attributes.uv.array, o * 2)
    o += g.attributes.position.count
  }
  const m = new THREE.BufferGeometry()
  m.setAttribute('position', new THREE.BufferAttribute(P, 3)); m.setAttribute('normal', new THREE.BufferAttribute(N, 3)); m.setAttribute('uv', new THREE.BufferAttribute(U, 2))
  return m
}
