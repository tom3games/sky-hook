// 見た目。course の一覧（当たりと同じデータ）から塔・棚・掛け点・仕掛けを作る。
// 遊ぶ面は半径 TOWER_R の円柱。2次元の (x, y, z) は「周に沿った距離・高さ・外向きのずれ」
import * as THREE from 'three'
import { TOWER_R } from './course.js?v=6'
import { anchorPos, hazardGeo, gustAt, floodLevel, bellK, solidAt, PH, boxOf } from './physics.js?v=6'

export const PAL = { sand: 0xdda675, sandM: 0xb0825d, shadow: 0x7e5c41, deep: 0x57391e, haze: 0x909eba, cloud: 0xd0cfd8, sky: 0x557198 }
const R = TOWER_R
export const WALL_R = R - 2.8      // 塔の壁の面（遊ぶ面との間 2.8m に飾りの凹凸を置く）

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
    this.buildDust()
    this.buildLandmarks()
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
    const arches = [], slits = [], pil = [], bandYs = []
    for (let y = -36, k = 0; y < yTop - 20; k++) {
      const tier = 10 + Math.floor(rnd() * 3) * 4          // 10〜18m の段
      bandYs.push(y)
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
    // 飛び出した石・欠けた石（壁を平らに見せない）。遊ぶ面より奥（最大 0.45m）
    const blocks = []
    for (let i = 0; i < (this.lowEnd ? 500 : 1100); i++) blocks.push([rnd() * 2 * Math.PI * R, -30 + rnd() * (yTop - 40), rnd()])
    const bg = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5)
    const imB = new THREE.InstancedMesh(bg, MAT.stone, blocks.length)
    { const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), pp = new THREE.Vector3(), ss = new THREE.Vector3()
      blocks.forEach(([x, y, r], i) => { const f = x / R; pp.set(Math.sin(f) * (WALL_R - 0.1), Math.round(y / 0.9) * 0.9, Math.cos(f) * (WALL_R - 0.1)); qq.setFromEuler(new THREE.Euler(0, f, (r - 0.5) * 0.05)); ss.set(1.2 + r * 1.6, 0.85, 0.12 + r * 0.33); mm.compose(pp, qq, ss); imB.setMatrixAt(i, mm) }) }
    imB.castShadow = true; imB.receiveShadow = true
    this.root.add(imB)
    // 帯の下の雨だれのしみ（暗いぼかしの板）
    const st = stainTex()
    const sm = new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false, color: 0xffffff, blending: THREE.MultiplyBlending, premultipliedAlpha: true, toneMapped: false, fog: false })
    const sg = new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0)
    const stains = []
    for (const b of bandYs) for (let i = 0; i < 26; i++) stains.push([rnd() * 2 * Math.PI * R, b - 0.3, 2 + rnd() * 5, 2 + rnd() * 6])
    const imS = new THREE.InstancedMesh(sg, sm, stains.length)
    { const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), pp = new THREE.Vector3(), ss = new THREE.Vector3()
      stains.forEach(([x, y, w, h], i) => { const f = x / R; pp.set(Math.sin(f) * (WALL_R + 0.03), y, Math.cos(f) * (WALL_R + 0.03)); qq.setFromEuler(new THREE.Euler(0, f, 0)); ss.set(w, h, 1); mm.compose(pp, qq, ss); imS.setMatrixAt(i, mm) }) }
    imS.renderOrder = 1
    this.root.add(imS)
    // 張り出した露台（手すりと持ち送り付き）。遊ぶ面より奥（壁から 1.9m まで）
    const balc = []
    for (let i = 0; i < (this.lowEnd ? 40 : 80); i++) balc.push([rnd() * 2 * Math.PI * R, -20 + rnd() * (yTop - 30), 2.4 + rnd() * 2.4])
    const parts = [
      [new THREE.BoxGeometry(1, 0.32, 0.65).translate(0, 0, 0.33), MAT.trim, 1],
      [new THREE.BoxGeometry(1, 0.9, 0.14).translate(0, 0.6, 0.6), MAT.stone, 1],
      [new THREE.BoxGeometry(1, 0.12, 0.22).translate(0, 1.08, 0.6), MAT.trim, 1],
    ]
    for (const [geo, mat] of parts) {
      const im = new THREE.InstancedMesh(geo, mat, balc.length)
      const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), pp = new THREE.Vector3(), ss = new THREE.Vector3()
      balc.forEach(([x, y, w], i) => { const f = x / R; pp.set(Math.sin(f) * WALL_R, y, Math.cos(f) * WALL_R); qq.setFromEuler(new THREE.Euler(0, f, 0)); ss.set(w, 1, 1); mm.compose(pp, qq, ss); im.setMatrixAt(i, mm) })
      im.castShadow = true; im.receiveShadow = true; this.root.add(im)
    }
    // 露台の下の持ち送り（2本ずつ）
    { const cg = new THREE.BoxGeometry(0.35, 0.9, 0.6).translate(0, -0.6, 0.3)
      const im = new THREE.InstancedMesh(cg, MAT.stone, balc.length * 2)
      const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), pp = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1)
      balc.forEach(([x, y, w], i) => { for (const sgn of [-1, 1]) { const xx = x + sgn * (w / 2 - 0.4), f = xx / R; pp.set(Math.sin(f) * WALL_R, y, Math.cos(f) * WALL_R); qq.setFromEuler(new THREE.Euler(0, f, 0)); mm.compose(pp, qq, one); im.setMatrixAt(i * 2 + (sgn > 0 ? 1 : 0), mm) } })
      im.castShadow = true; im.receiveShadow = true; this.root.add(im) }
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
    const n = this.lowEnd ? 160 : 340
    const per = [[], [], [], []]
    for (let i = 0; i < n; i++) {
      const x = rnd() * 2 * Math.PI * R, y = -20 + rnd() * (this.yTop - 30)
      per[Math.floor(rnd() * 4)].push([x, y, 4 + rnd() * 9, (rnd() - 0.5) * 0.15, 1 + rnd() * 0.8])
    }
    per.forEach((list, k) => {
      const t = tx.clone(); t.repeat.set(0.25, 1); t.offset.set(k * 0.25, 0); t.needsUpdate = true
      const mat = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, color: 0xd8e2b0 })
      const geo = new THREE.PlaneGeometry(1.6, 1).translate(0, -0.5, 0)
      const im = new THREE.InstancedMesh(geo, mat, list.length)
      const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), pp = new THREE.Vector3(), ss = new THREE.Vector3()
      list.forEach(([x, y, h, rot, w], i) => { const f = x / R; pp.set(Math.sin(f) * (WALL_R + 0.12), y, Math.cos(f) * (WALL_R + 0.12)); qq.setFromEuler(new THREE.Euler(0, f, rot)); ss.set(w, h, 1); mm.compose(pp, qq, ss); im.setMatrixAt(i, mm) })
      im.castShadow = true; im.receiveShadow = true
      im.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: t, alphaTest: 0.45 })
      this.root.add(im)
    })
  }

  buildSolids() {
    for (const s of this.W.solids) {
      const mat = s.mat === 'stone' ? MAT.moss : (MAT[s.mat] || MAT.stone)
      const bx = boxOf(s), z0 = Math.min(bx.z0, WALL_R - R - 0.4), z1 = bx.z1
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
      const az = a.z || 0
      const bz0 = WALL_R - R - 0.2, bz1 = az - 0.35
      // 台座の形は3種（石の持ち送り・木の梁・鉄の腕）。崩れる点はいつもひびの入った石
      // 外へ遠い輪は長い木の梁の先（絵 C の梁）
      const style = kind === 'crumble' ? 0 : az > 1.2 ? 1 : ((a.i * 7 + 3) % 10 < 6 ? 0 : (a.i * 7 + 3) % 10 < 9 ? 1 : 2)
      let base
      if (style === 0) base = new THREE.Mesh(bentBox(a.x, a.y + 0.2, 1.3, 1.05, 0, bz0, bz1), kind === 'crumble' ? MAT.crack : MAT.stone)
      else if (style === 1) base = new THREE.Mesh(bentBox(a.x, a.y + 0.62, 0.42, 0.42, 0, bz0, az + 0.2), MAT.wood)
      else base = new THREE.Mesh(bentBox(a.x, a.y + 0.45, 0.16, 0.22, 0, bz0, az + 0.05), MAT.iron)
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
          const rail = new THREE.Mesh(bentBox(a.x, a.y + 0.55, len, 0.22, Math.atan2(m.dy || 0, m.dx || 0), bz0, az - 0.5), MAT.iron)
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
          const sail = new THREE.Mesh(new THREE.BoxGeometry(h.len * 0.78, h.hw * 2 + 0.5, (h.dz || 0.9) * 2), MAT.wood); sail.position.set(h.len * 0.58, h.hw + 0.2, 0); arm.add(sail)
          arm.rotation.z = k * Math.PI * 2 / h.n
          spar.castShadow = sail.castShadow = true
          g.add(arm)
        }
        const axl = (h.z || 0) - (WALL_R - R) + 0.5
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, axl, 16), MAT.iron); hub.rotation.x = Math.PI / 2; hub.position.z = -axl / 2 + (h.dz || 0.9); g.add(hub)
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
      to3(f.x - 1.05, f.y, (f.z || 0) + 0.1, g.position); g.rotation.y = (f.x - 1.05) / R
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

  buildLandmarks() {
    const C = this.W.course
    // 出発の広場: 折れた柱（遊ぶ面より奥）
    const colG = new THREE.CylinderGeometry(0.55, 0.62, 1, 14)
    const capG = new THREE.BoxGeometry(1.6, 0.4, 1.6)
    for (const [x, h] of [[-14, 6.5], [-10.5, 3.2], [-6.5, 7.5], [-3, 2.2]]) {
      const c = new THREE.Mesh(colG, MAT.trim); to3(x, h / 2, -2.2, c.position); c.scale.y = h; c.rotation.y = x / R; c.castShadow = c.receiveShadow = true; this.root.add(c)
      const b = new THREE.Mesh(capG, MAT.stone); to3(x, 0.2, -2.2, b.position); b.rotation.y = x / R; b.castShadow = b.receiveShadow = true; this.root.add(b)
      if (h > 6) { const cp = new THREE.Mesh(capG, MAT.trim); to3(x, h, -2.2, cp.position); cp.rotation.y = x / R; cp.castShadow = true; this.root.add(cp) }
    }
    // 頂上の門: 2本の柱と梁、その上に大きな旗
    const T = C.top
    const gx = T.x, gy = T.y
    for (const dx of [-5, 5]) {
      const c = new THREE.Mesh(colG, MAT.trim); to3(gx + dx, gy + 4, -2.2, c.position); c.scale.set(1.3, 8, 1.3); c.rotation.y = (gx + dx) / R; c.castShadow = c.receiveShadow = true; this.root.add(c)
    }
    const beam = new THREE.Mesh(bentBox(gx, gy + 8.6, 13, 1.3, 0, WALL_R - R, -1.7), MAT.trim); beam.castShadow = true; this.root.add(beam)
    const cg = new THREE.PlaneGeometry(4, 6, 10, 12); cg.translate(0, -3, 0)
    const cm = MAT.cloth.clone(); cm.map = bannerTex(); cm.alphaTest = 0.5; cm.color.set(0xffffff)
    const ban = new THREE.Mesh(cg, cm); to3(gx, gy + 8, -1.9, ban.position); ban.rotation.y = gx / R; ban.castShadow = true; this.root.add(ban)
    this.flagMeshes.push({ f: { x: gx, y: gy }, g: ban, cloth: ban, base: cg.attributes.position.array.slice(), big: true })
  }

  buildDust() {
    // 風に舞う砂ぼこり（カメラのまわりに漂う粒。突風の中では濃く速く）
    const n = this.lowEnd ? 260 : 600
    const g = new THREE.BufferGeometry()
    this.dustP = new Float32Array(n * 3); this.dustS = []
    const r = mulberry(77)
    for (let i = 0; i < n; i++) this.dustS.push({ x: (r() - 0.5) * 50, y: (r() - 0.5) * 40, z: -1 + r() * 14, sp: 0.6 + r() * 1.4, ph: r() * 6 })
    g.setAttribute('position', new THREE.BufferAttribute(this.dustP, 3))
    const c = document.createElement('canvas'); c.width = c.height = 32
    const x = c.getContext('2d'), gr = x.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,240,215,1)'); gr.addColorStop(1, 'rgba(255,240,215,0)'); x.fillStyle = gr; x.fillRect(0, 0, 32, 32)
    const m = new THREE.PointsMaterial({ size: 0.13, map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0.55, color: 0xf3dcb4 })
    this.dust = new THREE.Points(g, m); this.dust.frustumCulled = false
    this.root.add(this.dust)
    this.dustOff = 0
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
      to3(q.x, q.y, q.z, am.g.position)
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
      if (h.k === 'blade') { to3(h.x, h.y, h.z, o.g.position); o.g.rotation.set(0, h.x / R, G.ang) }
      else if (h.k === 'ball') {
        to3(h.x, h.y, h.z, o.g.position); o.g.rotation.set(0, h.x / R, G.th)
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
        if (fm.big) { p.setZ(i, Math.sin(y * 1.1 - t * 2.4 + x * 0.6) * 0.18 * (-y / 6)); continue }
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
    // 砂ぼこり
    if (this.dust && ui.camX != null) {
      let gust = 0
      for (const gs of W.gusts) if (Math.abs((gs.y0 + gs.y1) / 2 - ui.camY) < 20) gust = Math.max(gust, gustAt(gs, t) * Math.sign(gs.fx))
      this.dustOff += dt * (1.2 + gust * 9)
      const v = new THREE.Vector3()
      this.dustS.forEach((d, i) => {
        let x = d.x + this.dustOff * d.sp; x = ((x + 25) % 50 + 50) % 50 - 25
        const y = d.y + Math.sin(t * 0.7 + d.ph) * 0.6 - this.dustOff * 0.08 * d.sp
        const yy = ((y + 20) % 40 + 40) % 40 - 20
        to3(ui.camX + x, ui.camY + yy, d.z, v)
        this.dustP[i * 3] = v.x; this.dustP[i * 3 + 1] = v.y; this.dustP[i * 3 + 2] = v.z
      })
      this.dust.geometry.attributes.position.needsUpdate = true
      this.dust.material.opacity = 0.4 + Math.abs(gust) * 0.4
    }
    // ワイヤー
    if (S.rope && ui.hand) {
      const a = W.anchors[S.rope.i]
      anchorPos(W, S, a, q)
      const p0 = ui.hand, p1 = to3(q.x, q.y, q.z)
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
      const p1 = to3(q.x, q.y, q.z + 0.3)
      this.aimLine.visible = true
      const pa = this.aimLine.geometry.attributes.position
      const p0 = to3(S.p.x, S.p.y + 0.4, S.p.z + 0.3)
      pa.setXYZ(0, p0.x, p0.y, p0.z); pa.setXYZ(1, p1.x, p1.y, p1.z); pa.needsUpdate = true
      this.aimLine.computeLineDistances()
      this.aimMark.visible = true; this.aimMark.position.copy(p1)
      this.aimMark.material.opacity = 0.6 + 0.4 * Math.sin(t * 14)
    } else { this.aimLine.visible = false; this.aimMark.visible = false }
  }
}

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
function stainTex() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128
  const x = c.getContext('2d'), r = mulberry(9)
  for (let i = 0; i < 18; i++) {
    const cx = 4 + r() * 56, w = 3 + r() * 9, h = 40 + r() * 88
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)')
    x.fillStyle = g; x.fillRect(cx - w / 2, 0, w, h)
  }
  // 白（=かけても変わらない）へ置き換える: 暗い所だけ色を落とす
  const d = x.getImageData(0, 0, 64, 128)
  for (let i = 0; i < d.data.length; i += 4) { const a = d.data[i + 3] / 255; const v = 255 * (1 - a * 0.6); d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255 }
  x.putImageData(d, 0, 0)
  const t = new THREE.CanvasTexture(c); return t
}
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
  x.beginPath(); x.arc(128, 78, 30, 0, Math.PI * 2); x.stroke()
  x.beginPath(); x.moveTo(128, 20); x.lineTo(128, 48); x.stroke()
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
