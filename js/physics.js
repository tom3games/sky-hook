// SKY HOOK の物理（3D）。塔の外周を開いた空間 (x=周に沿った距離, y=高さ, z=壁から外への距離) で解く。
// 塔の半径は 40m あるので、開いても形はほとんど変わらない。見た目は同じ (x,y,z) を円柱へ巻いて描く（view.js の to3）。
// 見た目（view.js）も当たり（ここ）も course.js の同じ一覧から作る。箱はすべて (x,y,z) の軸にそろった箱。
// 固定 60Hz の入力 × SUB 分割。node でもブラウザでも同じ入力なら同じ結果になる（Math.random を使わない）。

export const PH = {
  dt: 1 / 60, sub: 4,
  g: 21,              // 重力。短いワイヤーでも振り子の周期が間延びしないよう地球より強め
  range: 7.0,         // ワイヤーが届く距離（m）
  minLen: 2.2,        // これより近い掛け点はこの長さで掛かる
  pump: 11,           // こぐ力（振れの向きと同じ側を押した時）
  ampCap: 1.45,       // こいで出せる振れの最大角（真下から, rad）
  pumpBack: 9,        // 振れと逆を押した時のブレーキ
  pumpFull: 1.15, pumpZero: 1.85,
  airCtl: 5, airMax: 7,
  walk: 4.2, walkAcc: 22,   // 足場の上を走る
  jump: 7.2,          // 跳ぶ速さ
  r: 0.38,
  maxFall: 34,
  wallZ: -1.6,        // 塔の壁（飾りの凹凸を含む）の面。体はこれより外
  regrab: 0.18, stun: 0.55,
  crumbleT: 2.2, crumbleBack: 6, bellT: 7,
  fallReset: 14,
}
const cl = (v, a, b) => v < a ? a : v > b ? b : v

// ---------------------------------------------------------------- 幾何
// 球と箱（軸そろえ）。返り値 {nx,ny,nz,d}
function sphereBox(px, py, pz, r, b) {
  const qx = cl(px, b.x0, b.x1), qy = cl(py, b.y0, b.y1), qz = cl(pz, b.z0, b.z1)
  let ex = px - qx, ey = py - qy, ez = pz - qz
  const d2 = ex * ex + ey * ey + ez * ez
  if (d2 > r * r) return null
  if (d2 > 1e-12) { const d = Math.sqrt(d2); return { nx: ex / d, ny: ey / d, nz: ez / d, d: r - d } }
  // 中心が中: 一番浅い面へ
  const c = [[px - b.x0, -1, 0, 0], [b.x1 - px, 1, 0, 0], [py - b.y0, 0, -1, 0], [b.y1 - py, 0, 1, 0], [pz - b.z0, 0, 0, -1], [b.z1 - pz, 0, 0, 1]]
  let m = c[0]; for (const e of c) if (e[0] < m[0]) m = e
  return { nx: m[1], ny: m[2], nz: m[3], d: m[0] + r }
}
// 線分が箱を横切るか（少し縮めた箱で）
function segBox(a, b, B, s) {
  let t0 = 0, t1 = 1
  const d = [b.x - a.x, b.y - a.y, b.z - a.z], o = [a.x, a.y, a.z]
  const lo = [B.x0 + s, B.y0 + s, B.z0 + s], hi = [B.x1 - s, B.y1 - s, B.z1 - s]
  for (let k = 0; k < 3; k++) {
    if (lo[k] > hi[k]) return false
    if (Math.abs(d[k]) < 1e-12) { if (o[k] < lo[k] || o[k] > hi[k]) return false; continue }
    let ta = (lo[k] - o[k]) / d[k], tb = (hi[k] - o[k]) / d[k]
    if (ta > tb) { const q = ta; ta = tb; tb = q }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb
    if (t0 > t1) return false
  }
  return true
}
function sphereSeg(p, r, a, b, w) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l2 = dx * dx + dy * dy + dz * dz
  const t = l2 > 0 ? cl(((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / l2, 0, 1) : 0
  const qx = a.x + dx * t, qy = a.y + dy * t, qz = a.z + dz * t
  const ex = p.x - qx, ey = p.y - qy, ez = p.z - qz, d = Math.hypot(ex, ey, ez)
  if (d > r + w) return null
  return { nx: d > 1e-9 ? ex / d : 0, ny: d > 1e-9 ? ey / d : 1, nz: d > 1e-9 ? ez / d : 0, d: r + w - d, q: { x: qx, y: qy, z: qz } }
}

// ---------------------------------------------------------------- 世界
const _seen = new Set()
export function near(m, band, y0, y1) {
  const out = []
  _seen.clear()
  for (let k = Math.floor(y0 / band); k <= Math.floor(y1 / band); k++) { const l = m.get(k); if (!l) continue; for (const o of l) if (!_seen.has(o)) { _seen.add(o); out.push(o) } }
  return out
}
export const ZDEF = { z0: -2.8, z1: 0.9 }
export function boxOf(s) {
  const z0 = s.z0 ?? ZDEF.z0, z1 = s.z1 ?? (s.perch ? 0.7 : s.mat === 'wood' ? 0.8 : ZDEF.z1)
  return { x0: s.x - s.w / 2, x1: s.x + s.w / 2, y0: s.y - s.h / 2, y1: s.y + s.h / 2, z0, z1 }
}
export function buildWorld(course) {
  const W = { course, solids: [], anchors: [], hazards: [], gusts: [], flags: [], floods: [], top: course.top, bounds: course.bounds }
  for (const s of course.solids) W.solids.push({ ...s, ...boxOf(s) })
  course.anchors.forEach((a, i) => W.anchors.push({ z: 0, ...a, i }))
  for (const h of course.hazards) W.hazards.push({ z: 0.2, ...h })
  for (const g of course.gusts) W.gusts.push({ ...g })
  for (const f of course.flags) W.flags.push({ ...f })
  for (const f of course.floods) W.floods.push({ ...f })
  const BAND = 6
  W.band = BAND
  W.sBands = new Map(); W.aBands = new Map(); W.hBands = new Map()
  const put = (m, y0, y1, o) => { for (let k = Math.floor(y0 / BAND); k <= Math.floor(y1 / BAND); k++) { if (!m.has(k)) m.set(k, []); m.get(k).push(o) } }
  for (const b of W.solids) { const e = b.bell ? Math.hypot(b.bell.dx, b.bell.dy) : 0; put(W.sBands, b.y0 - e, b.y1 + e, b) }
  for (const a of W.anchors) { const e = a.move ? (a.move.r || Math.hypot(a.move.dx || 0, a.move.dy || 0)) : 0; put(W.aBands, a.y - e, a.y + e, a) }
  for (const h of W.hazards) { const e = (h.len || 0) + (h.L || 0) + (h.r || 0) + 1; put(W.hBands, h.y - e, h.y + e, h) }
  return W
}

export function anchorPos(W, S, a, out) {
  let x = a.x, y = a.y, z = a.z || 0
  if (a.move) {
    const m = a.move, ph = (S.t * m.w + (m.ph || 0))
    if (m.k === 'line') { const s = Math.sin(ph); x += (m.dx || 0) * s; y += (m.dy || 0) * s; z += (m.dz || 0) * s }
    else if (m.k === 'circle') { x += m.r * Math.cos(ph); y += m.r * Math.sin(ph) }
  }
  const st = S.an[a.i]
  if (st.fallT > 0) y -= 0.5 * 20 * st.fallT * st.fallT
  out.x = x; out.y = y; out.z = z
  return out
}
export function bellK(S, g) {
  const t0 = S.bell[g]; if (t0 == null) return 0
  const e = S.t - t0, T = PH.bellT
  if (e < 0) return 0
  if (e < 0.6) return e / 0.6
  if (e < T) return 1
  if (e < T + 0.8) return 1 - (e - T) / 0.8
  return 0
}
export function solidAt(W, S, b) {
  if (!b.bell) return b
  const k = bellK(S, b.bell.g)
  if (k === 0) return b
  const o = solidAt._o || (solidAt._o = {})
  Object.assign(o, b)
  const dx = b.bell.dx * k, dy = b.bell.dy * k
  o.x0 = b.x0 + dx; o.x1 = b.x1 + dx; o.y0 = b.y0 + dy; o.y1 = b.y1 + dy; o.x = b.x + dx; o.y = b.y + dy
  return o
}
// 羽根と鉄球は壁に平行な面（z 一定）で動く。体はその面の手前を回り込める
export function hazardGeo(h, t) {
  if (h.k === 'blade') {
    const a0 = h.w * t + (h.ph || 0), segs = []
    for (let k = 0; k < h.n; k++) { const a = a0 + k * Math.PI * 2 / h.n; segs.push([{ x: h.x, y: h.y, z: h.z }, { x: h.x + Math.cos(a) * h.len, y: h.y + Math.sin(a) * h.len, z: h.z }]) }
    return { segs, w: h.hw, ang: a0 }
  }
  if (h.k === 'ball') {
    const th = h.A * Math.sin(h.w * t + (h.ph || 0))
    return { bx: h.x + Math.sin(th) * h.L, by: h.y - Math.cos(th) * h.L, bz: h.z, th, r: h.r }
  }
  return null
}
export function gustAt(g, t) {
  const T = g.period, e = ((t + (g.ph || 0)) % T + T) % T
  const on = g.duty * T
  if (e > on) return 0
  return Math.min(1, Math.min(e, on - e) / 0.5)
}
export function floodLevel(W, S, i) {
  const f = W.floods[i], st = S.fl[i]
  if (st.start == null) return f.y0
  return Math.min(f.yMax, f.y0 + Math.max(0, S.t - st.start - (f.delay || 0)) * f.rate)
}

// ---------------------------------------------------------------- 状態
export function newState(W, at) {
  const sp = at || W.course.spawn
  const z = sp.z ?? 0
  return {
    t: 0, frame: 0,
    p: { x: sp.x, y: sp.y, z, vx: 0, vy: 0, vz: 0, ground: false, gn: { x: 0, y: 1, z: 0 }, stun: 0, face: 1 },
    rope: null,
    hookPrev: false, jumpPrev: false, lastI: -1, lastT: -9,
    an: W.anchors.map(() => ({ crT: -1, fallT: 0, back: 0, used: false })),
    bell: {}, fl: W.floods.map(() => ({ start: null })),
    cp: -1, cpX: sp.x, cpY: sp.y, cpZ: z, best: sp.y, falls: 0, grabs: 0, done: false, doneT: 0,
    ev: [],
  }
}
export function cloneState(S) {
  return { ...S, p: { ...S.p, gn: { ...S.p.gn } }, rope: S.rope ? { ...S.rope } : null, an: S.an.map(a => ({ ...a })), bell: { ...S.bell }, fl: S.fl.map(f => ({ ...f })), ev: [] }
}

// ---------------------------------------------------------------- 掛け点
const _a = { x: 0, y: 0, z: 0 }
export function losClear(W, S, a, b) {
  for (const b0 of near(W.sBands, W.band, Math.min(a.y, b.y), Math.max(a.y, b.y))) {
    if (b0.noLos) continue
    const B = solidAt(W, S, b0)
    if (segBox(a, b, B, 0.06)) return false
  }
  return true
}
export function anchorUsable(W, S, a) {
  const st = S.an[a.i]
  if (st.fallT > 0 || st.back > 0) return false
  if (a.kind === 'rusty' && st.used) return false
  if (a.hidden && bellK(S, a.hidden.g) < 0.95) return false
  return true
}
export function canGrab(W, S, i) {
  const a = W.anchors[i]; if (!a) return false
  if (!anchorUsable(W, S, a)) return false
  if (i === S.lastI && S.t - S.lastT < PH.regrab) return false
  const p = S.p
  const q = anchorPos(W, S, a, _a)
  const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z
  if (dx * dx + dy * dy + dz * dz > PH.range * PH.range) return false
  return losClear(W, S, p, q)
}
export function grabbable(W, S) {
  const out = [], p = S.p
  for (const a of near(W.aBands, W.band, p.y - PH.range - 1, p.y + PH.range + 1)) {
    if (Math.abs(a.x - p.x) > PH.range + 8) continue
    if (canGrab(W, S, a.i)) out.push(a.i)
  }
  return out
}

// ---------------------------------------------------------------- 1コマ
// inp: { mx, mz: -1..1（移動・こぐ向き。x=周に沿って右、z=外へ）, hook: bool, target, jump: bool }
export function step(W, S, inp) {
  const h = PH.dt / PH.sub
  const p = S.p
  const hook = !!inp.hook
  if (!hook && S.rope) detach(W, S, false)
  if (hook && S.rope && inp.target != null && inp.target >= 0 && inp.target !== S.rope.i && !S.hookPrev) {
    if (canGrab(W, S, inp.target)) { detach(W, S, false); attach(W, S, inp.target) }
  }
  if (hook && !S.rope && p.stun <= 0 && inp.target != null && inp.target >= 0 && canGrab(W, S, inp.target)) attach(W, S, inp.target)
  S.hookPrev = hook
  // 跳ぶ（足場の上で、押した瞬間）
  if (inp.jump && !S.jumpPrev && p.ground && !S.rope) { p.vy = PH.jump; p.ground = false; S.ev.push({ t: 'jump' }) }
  S.jumpPrev = !!inp.jump

  for (let k = 0; k < PH.sub; k++) substep(W, S, inp, h)

  for (const a of W.anchors) {
    const st = S.an[a.i]
    if (st.fallT > 0) { st.fallT += PH.dt; if (st.fallT > 2.5) { st.fallT = 0; st.back = PH.crumbleBack } }
    else if (st.back > 0) { st.back -= PH.dt; if (st.back <= 0) { st.back = 0; st.crT = -1 } }
    if (a.kind === 'crumble' && st.crT >= 0 && st.fallT === 0 && st.back === 0) {
      st.crT += PH.dt
      if (st.crT > (a.crumbleT || PH.crumbleT)) {
        st.fallT = 1e-6
        if (S.rope && S.rope.i === a.i) detach(W, S, true)
        S.ev.push({ t: 'crumble', i: a.i })
      }
    }
  }
  for (let i = 0; i < W.floods.length; i++) {
    const f = W.floods[i], st = S.fl[i]
    if (st.start == null && p.y > f.trigY && p.x > f.x0 && p.x < f.x1) { st.start = S.t; S.ev.push({ t: 'flood', i }) }
    if (st.start != null && p.y - PH.r * 0.5 < floodLevel(W, S, i) && p.x > f.x0 - 4 && p.x < f.x1 + 4) { S.ev.push({ t: 'drown', i }); respawn(W, S, true); return }
  }
  for (let i = 0; i < W.flags.length; i++) {
    const f = W.flags[i]
    if (i > S.cp && Math.abs(p.x - f.x) < (f.w || 3) / 2 + 0.2 && p.y > f.y - 0.2 && p.y < f.y + 2.4 && p.z < (f.z ?? 0) + 2) setCp(W, S, i)
  }
  if (p.y > S.best) S.best = p.y
  if (p.y < S.cpY - PH.fallReset || p.y < W.bounds.y0) { S.ev.push({ t: 'fall' }); respawn(W, S, true); return }
  if (!S.done && p.y > W.top.y && Math.abs(p.x - W.top.x) < W.top.w) { S.done = true; S.doneT = S.t; S.ev.push({ t: 'top' }) }
  S.t += PH.dt; S.frame++
}
function setCp(W, S, k) { const f = W.flags[k]; S.cp = k; S.cpX = f.x; S.cpY = f.y + 0.4; S.cpZ = f.z ?? 0; S.ev.push({ t: 'flag', i: k }) }

function attach(W, S, i) {
  const a = W.anchors[i], p = S.p
  const q = anchorPos(W, S, a, _a)
  const d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z)
  S.rope = { i, L: Math.max(PH.minLen, d), t: 0 }
  S.grabs++
  const st = S.an[i]
  if (a.kind === 'crumble' && st.crT < 0) st.crT = 0
  if (a.kind === 'bell') { S.bell[a.g] = S.t; S.ev.push({ t: 'bell', i, g: a.g }) }
  if (a.flag) { const k = W.flags.findIndex(f => f.a === i); if (k > S.cp) setCp(W, S, k) }
  S.ev.push({ t: 'grab', i, d })
}
export function detach(W, S, forced) {
  const r = S.rope; if (!r) return
  const a = W.anchors[r.i]
  if (a.kind === 'rusty') { S.an[r.i].used = true; S.ev.push({ t: 'rustbreak', i: r.i }) }
  S.lastI = r.i; S.lastT = S.t
  S.rope = null
  S.ev.push({ t: 'release', i: r.i, forced, v: Math.hypot(S.p.vx, S.p.vy, S.p.vz) })
}
export function respawn(W, S, fell) {
  S.rope = null
  const p = S.p
  p.x = S.cpX; p.y = S.cpY; p.z = S.cpZ; p.vx = p.vy = p.vz = 0; p.stun = 0; p.ground = false
  if (fell) S.falls++
  for (const st of S.an) { st.used = false; st.crT = -1; st.fallT = 0; st.back = 0 }
  for (const f of S.fl) f.start = null
  S.bell = {}
  S.hookPrev = true
  S.ev.push({ t: 'respawn' })
}

const _q = { x: 0, y: 0, z: 0 }, _q2 = { x: 0, y: 0, z: 0 }
function substep(W, S, inp, h) {
  const p = S.p, t = S.t
  let ux = cl(inp.mx || 0, -1, 1), uz = cl(inp.mz || 0, -1, 1)
  const ul = Math.hypot(ux, uz); if (ul > 1) { ux /= ul; uz /= ul }
  const um = Math.min(1, ul)
  p.stun = Math.max(0, p.stun - h)
  let ax = 0, ay = -PH.g, az = 0
  for (const g of W.gusts) {
    if (p.x < g.x0 || p.x > g.x1 || p.y < g.y0 || p.y > g.y1) continue
    const k = gustAt(g, t)
    ax += g.fx * k; ay += (g.fy || 0) * k
  }
  const r = S.rope
  if (r) {
    r.t += h
    const q = anchorPos(W, S, W.anchors[r.i], _q)
    const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z, d = Math.hypot(dx, dy, dz) || 1e-6
    if (um > 0 && d >= r.L - 0.05) {
      // 入れた向き（水平）を、振り子の球面の接平面へ写す
      const nx = dx / d, ny = dy / d, nz = dz / d
      const dot = ux * nx + uz * nz
      let fx = ux - dot * nx, fy = -dot * ny, fz = uz - dot * nz
      const fl = Math.hypot(fx, fy, fz)
      if (fl > 1e-6) {
        fx /= fl; fy /= fl; fz /= fl
        const cosTh = -ny, vf = p.vx * fx + p.vy * fy + p.vz * fz
        const th = Math.acos(cl(cosTh, -1, 1))
        const kAng = th < PH.pumpFull ? 1 : th > PH.pumpZero ? 0 : 1 - (th - PH.pumpFull) / (PH.pumpZero - PH.pumpFull)
        const same = vf >= -0.05
        let k = kAng
        if (same) {
          const v2 = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz
          const c = cosTh - v2 / (2 * PH.g * r.L)
          const thMax = c <= -1 ? Math.PI : Math.acos(c > 1 ? 1 : c)
          k *= cl((PH.ampCap - thMax) / 0.15, 0, 1)
        }
        const f = (same ? PH.pump * k : PH.pumpBack) * um
        ax += fx * f; ay += fy * f; az += fz * f
      }
    }
  } else if (!p.ground) {
    // 空中: 少しだけ寄せられる
    if (um > 0) {
      const vh = p.vx * ux + p.vz * uz
      if (vh < PH.airMax) { ax += ux * PH.airCtl * um; az += uz * PH.airCtl * um }
    }
  }
  p.vx += ax * h; p.vy += ay * h; p.vz += az * h
  if (p.ground && !r) {
    // 走る（入れた向きへ、面に沿って）
    const wx = ux * PH.walk * um, wz = uz * PH.walk * um
    const dvx = cl(wx - p.vx, -PH.walkAcc * h, PH.walkAcc * h), dvz = cl(wz - p.vz, -PH.walkAcc * h, PH.walkAcc * h)
    p.vx += dvx; p.vz += dvz
  }
  if (p.vy < -PH.maxFall) p.vy = -PH.maxFall
  p.x += p.vx * h; p.y += p.vy * h; p.z += p.vz * h
  // ワイヤー（長さより遠くへ行けない。動く点は相対速度で）
  if (r) {
    const a = W.anchors[r.i]
    const q = anchorPos(W, S, a, _q)
    const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z, d = Math.hypot(dx, dy, dz)
    if (d > r.L) {
      const nx = dx / d, ny = dy / d, nz = dz / d
      p.x = q.x + nx * r.L; p.y = q.y + ny * r.L; p.z = q.z + nz * r.L
      let avx = 0, avy = 0, avz = 0
      if (a.move) { const t0 = S.t; S.t += 1e-3; anchorPos(W, S, a, _q2); S.t = t0; avx = (_q2.x - q.x) / 1e-3; avy = (_q2.y - q.y) / 1e-3; avz = (_q2.z - q.z) / 1e-3 }
      const rv = (p.vx - avx) * nx + (p.vy - avy) * ny + (p.vz - avz) * nz
      if (rv > 0) { p.vx -= rv * nx; p.vy -= rv * ny; p.vz -= rv * nz }
    }
  }
  // 塔の壁
  if (p.z < PH.wallZ + PH.r) { p.z = PH.wallZ + PH.r; if (p.vz < 0) { if (p.vz < -9) S.ev.push({ t: 'thud', v: -p.vz }); p.vz = 0 } }
  // 地形
  p.ground = false
  for (let it = 0; it < 2; it++) {
    for (const b0 of near(W.sBands, W.band, p.y - 1, p.y + 1)) {
      const b = solidAt(W, S, b0)
      if (p.x < b.x0 - 1 || p.x > b.x1 + 1 || p.z < b.z0 - 1 || p.z > b.z1 + 1) continue
      const c = sphereBox(p.x, p.y, p.z, PH.r, b)
      if (!c) continue
      p.x += c.nx * c.d; p.y += c.ny * c.d; p.z += c.nz * c.d
      const vn = p.vx * c.nx + p.vy * c.ny + p.vz * c.nz
      if (vn < 0) {
        p.vx -= vn * c.nx; p.vy -= vn * c.ny; p.vz -= vn * c.nz
        if (vn < -9) S.ev.push({ t: 'thud', v: -vn })
      }
      if (c.ny > 0.6) {
        p.ground = true; p.gn.x = c.nx; p.gn.y = c.ny; p.gn.z = c.nz
        if (!r && um === 0) { const k = Math.max(0, 1 - (b.slip ? 1.5 : 12) * h); p.vx *= k; p.vz *= k }
      }
    }
  }
  // 仕掛け
  if (p.stun <= 0) {
    for (const hz of near(W.hBands, W.band, p.y - 1, p.y + 1)) {
      if (Math.abs(hz.x - p.x) > (hz.reach || 12) || Math.abs(hz.z - p.z) > 3) continue
      const G = hazardGeo(hz, t)
      let hit = null, hv = { x: 0, y: 0 }
      if (hz.k === 'blade') {
        // 羽根は奥行き 2*dz の板（その手前・奥は通れる）
        const dz = hz.dz || 0.9, ez = p.z - hz.z
        const pp = { x: p.x, y: p.y, z: Math.abs(ez) < dz ? hz.z : p.z - Math.sign(ez) * dz }
        for (const s of G.segs) {
          const c = sphereSeg(pp, PH.r, s[0], s[1], G.w)
          if (c) { hit = c; const rx = c.q.x - hz.x, ry = c.q.y - hz.y; hv = { x: -ry * hz.w, y: rx * hz.w }; break }
        }
      } else if (hz.k === 'ball') {
        const dx = p.x - G.bx, dy = p.y - G.by, dz = p.z - G.bz, d = Math.hypot(dx, dy, dz)
        if (d < PH.r + G.r) {
          hit = { nx: dx / (d || 1), ny: dy / (d || 1), nz: dz / (d || 1), d: PH.r + G.r - d }
          const dth = hz.A * hz.w * Math.cos(hz.w * t + (hz.ph || 0))
          hv = { x: Math.cos(G.th) * hz.L * dth, y: Math.sin(G.th) * hz.L * dth }
        }
      }
      if (hit) {
        p.x += hit.nx * hit.d; p.y += hit.ny * hit.d; p.z += hit.nz * hit.d
        const kick = hz.kick || 9
        p.vx = hv.x * 0.8 + hit.nx * kick; p.vy = hv.y * 0.8 + hit.ny * kick * 0.6 + 2; p.vz = hit.nz * kick + 1.5
        p.stun = PH.stun
        if (S.rope) detach(W, S, true)
        S.ev.push({ t: 'hit', k: hz.k })
        break
      }
    }
  }
  if (p.vx > 0.3) p.face = 1; else if (p.vx < -0.3) p.face = -1
}

// 振れの角と、エネルギーから出した振れの最大角
export function swingInfo(W, S) {
  const r = S.rope; if (!r) return null
  const q = anchorPos(W, S, W.anchors[r.i], { x: 0, y: 0, z: 0 })
  const dx = S.p.x - q.x, dy = S.p.y - q.y, dz = S.p.z - q.z, d = Math.hypot(dx, dy, dz) || 1
  const cosTh = -dy / d, th = Math.acos(cl(cosTh, -1, 1))
  const v2 = S.p.vx * S.p.vx + S.p.vy * S.p.vy + S.p.vz * S.p.vz
  const c = cosTh - v2 / (2 * PH.g * r.L)
  const thMax = c <= -1 ? Math.PI : Math.acos(cl(c, -1, 1))
  // 外へ向かっているか（振れの頂点へ近づいている）
  const out = (S.p.vx * dx + S.p.vz * dz) > 0
  return { th, thMax, out, L: r.L, ax: q.x, ay: q.y, az: q.z }
}
