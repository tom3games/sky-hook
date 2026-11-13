// SKY HOOK の物理。塔の外周（半径 R の円柱面）を開いた2次元 (x=周に沿った距離, y=高さ) で解く。
// 見た目（view.js）も当たり（ここ）も course.js の同じ一覧から作る。
// 固定 60Hz の入力 × SUB 分割。node でもブラウザでも同じ入力なら同じ結果になる（Math.random を使わない）。

export const PH = {
  dt: 1 / 60, sub: 4,
  g: 21,              // 重力。短いワイヤーでも振り子の周期が間延びしないよう地球より強め
  range: 7.0,         // ワイヤーが届く距離（m）
  minLen: 2.2,        // これより近い掛け点はこの長さで掛かる
  pump: 11,           // こぐ力（振れの向きと同じ側を押した時）
  ampCap: 1.45,       // こいで出せる振れの最大角（真下から, rad）。これより大きい振れは突風や動く点の勢いだけ
  pumpBack: 9,        // 振れと逆を押した時のブレーキ
  pumpFull: 1.15,     // この角度（真下から, rad）まではこぐ力が満額
  pumpZero: 1.85,     // この角度でこぐ力が 0（だいたい水平より少し上）
  airCtl: 5,          // 空中で左右に寄せる力
  airMaxVx: 7,        // 空中の寄せで出せる横速度の上限（勢いのある時は減らさない）
  walk: 2.4,          // 地面を歩く速さ（遅い。地面は不利）
  walkAcc: 14,
  r: 0.38,            // 体の当たりの半径
  maxFall: 34,
  grabBuffer: 0.3,    // 押してから掛け点が入るのを待つ時間
  regrab: 0.18,       // 離した直後に同じ点へ掛け直せるまで
  stun: 0.55,         // 仕掛けに当たって手が離れている時間
  crumbleT: 2.2,      // 崩れる掛け点が落ちるまで
  crumbleBack: 6,     // 崩れた点が戻るまで
  bellT: 7,           // 鐘を鳴らしてから仕掛けが元に戻るまで
  fallReset: 14,      // 旗の高さからこれだけ下に落ちたら旗へ戻す
}

// ---------------------------------------------------------------- 幾何
const cl = (v, a, b) => v < a ? a : v > b ? b : v

// 回転した箱と円。返り値 {nx,ny,d}（d>0 でめり込み）
function circleBox(px, py, r, b) {
  const c = b.ca, s = b.sa
  const dx = px - b.x, dy = py - b.y
  const lx = dx * c + dy * s, ly = -dx * s + dy * c
  const qx = cl(lx, -b.hw, b.hw), qy = cl(ly, -b.hh, b.hh)
  let ex = lx - qx, ey = ly - qy
  let d2 = ex * ex + ey * ey
  if (d2 > r * r) return null
  let nlx, nly, depth
  if (d2 > 1e-12) { const d = Math.sqrt(d2); nlx = ex / d; nly = ey / d; depth = r - d }
  else {
    // 中心が箱の中: 一番近い面へ
    const ox = b.hw - Math.abs(lx), oy = b.hh - Math.abs(ly)
    if (ox < oy) { nlx = Math.sign(lx) || 1; nly = 0; depth = ox + r } else { nlx = 0; nly = Math.sign(ly) || 1; depth = oy + r }
  }
  return { nx: nlx * c - nly * s, ny: nlx * s + nly * c, d: depth }
}
// 線分 (ax,ay)-(bx,by) が箱を横切るか（端の少し手前で止める）
function segBox(ax, ay, bx, by, b, shrink) {
  const c = b.ca, s = b.sa
  const tx = (x, y) => [(x - b.x) * c + (y - b.y) * s, -(x - b.x) * s + (y - b.y) * c]
  const [x0, y0] = tx(ax, ay), [x1, y1] = tx(bx, by)
  const hw = b.hw - shrink, hh = b.hh - shrink
  if (hw <= 0 || hh <= 0) return false
  let t0 = 0, t1 = 1
  const dx = x1 - x0, dy = y1 - y0
  for (const [p, q] of [[-dx, x0 + hw], [dx, hw - x0], [-dy, y0 + hh], [dy, hh - y0]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue }
    const t = q / p
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t } else { if (t < t0) return false; if (t < t1) t1 = t }
  }
  return t0 <= t1
}
function circleSeg(px, py, r, ax, ay, bx, by, w) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
  const t = l2 > 0 ? cl(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0
  const qx = ax + dx * t, qy = ay + dy * t
  const ex = px - qx, ey = py - qy, d = Math.hypot(ex, ey)
  if (d > r + w) return null
  return { nx: d > 1e-9 ? ex / d : 0, ny: d > 1e-9 ? ey / d : 1, d: r + w - d, qx, qy }
}

// ---------------------------------------------------------------- 世界（course の一覧から）
// y0..y1 の帯に入る物（重複なし）
const _seen = new Set()
export function near(m, band, y0, y1) {
  const out = []
  _seen.clear()
  for (let k = Math.floor(y0 / band); k <= Math.floor(y1 / band); k++) { const l = m.get(k); if (!l) continue; for (const o of l) if (!_seen.has(o)) { _seen.add(o); out.push(o) } }
  return out
}
export function buildWorld(course) {
  const W = { course, solids: [], anchors: [], hazards: [], gusts: [], flags: [], floods: [], top: course.top, bounds: course.bounds }
  for (const s of course.solids) {
    const b = { ...s, hw: s.w / 2, hh: s.h / 2, ca: Math.cos(s.a || 0), sa: Math.sin(s.a || 0) }
    W.solids.push(b)
  }
  course.anchors.forEach((a, i) => W.anchors.push({ ...a, i }))
  for (const h of course.hazards) W.hazards.push({ ...h })
  for (const g of course.gusts) W.gusts.push({ ...g })
  for (const f of course.flags) W.flags.push({ ...f })
  for (const f of course.floods) W.floods.push({ ...f })
  // 高さの帯ごとの一覧（近くの物だけ調べる）。鐘で動く壁は動く範囲ぶん広げて入れる
  const BAND = 6
  W.band = BAND
  W.sBands = new Map(); W.aBands = new Map(); W.hBands = new Map()
  const put = (m, y0, y1, o) => { for (let k = Math.floor(y0 / BAND); k <= Math.floor(y1 / BAND); k++) { if (!m.has(k)) m.set(k, []); m.get(k).push(o) } }
  for (const b of W.solids) { const e = b.hw + b.hh + (b.bell ? Math.hypot(b.bell.dx, b.bell.dy) : 0); put(W.sBands, b.y - e, b.y + e, b) }
  for (const a of W.anchors) { const e = a.move ? (a.move.r || Math.hypot(a.move.dx || 0, a.move.dy || 0)) : 0; put(W.aBands, a.y - e, a.y + e, a) }
  for (const h of W.hazards) { const e = (h.len || 0) + (h.L || 0) + (h.r || 0) + 1; put(W.hBands, h.y - e, h.y + e, h) }
  return W
}

// 時間で決まる物の位置（全部 t の式。状態を持たないので bot が先読みできる）
export function anchorPos(W, S, a, out) {
  let x = a.x, y = a.y
  if (a.move) {
    const m = a.move, ph = (S.t * m.w + (m.ph || 0))
    if (m.k === 'line') { const s = Math.sin(ph); x += m.dx * s; y += m.dy * s }
    else if (m.k === 'circle') { x += m.r * Math.cos(ph); y += m.r * Math.sin(ph) }
  }
  const st = S.an[a.i]
  if (a.bellMove && S.bell[a.bellMove.g] != null) {
    const k = bellK(S, a.bellMove.g)
    x += a.bellMove.dx * k; y += a.bellMove.dy * k
  }
  if (st.fallT > 0) y -= 0.5 * 20 * st.fallT * st.fallT
  out.x = x; out.y = y
  return out
}
// 鐘の効き（0..1）。鳴らしてすぐ動き出し、bellT のあいだ開いてから戻る
export function bellK(S, g) {
  const t0 = S.bell[g]; if (t0 == null) return 0
  const e = S.t - t0
  const T = PH.bellT
  if (e < 0) return 0
  if (e < 0.6) return e / 0.6
  if (e < T) return 1
  if (e < T + 0.8) return 1 - (e - T) / 0.8
  return 0
}
export function solidAt(W, S, b) {
  // 鐘で動く壁
  if (!b.bell) return b
  const k = bellK(S, b.bell.g)
  if (k === 0) return b
  const o = solidAt._o || (solidAt._o = {})
  Object.assign(o, b); o.x = b.x + b.bell.dx * k; o.y = b.y + b.bell.dy * k
  return o
}
export function hazardGeo(h, t) {
  if (h.k === 'blade') {
    const a0 = h.w * t + (h.ph || 0), segs = []
    for (let k = 0; k < h.n; k++) { const a = a0 + k * Math.PI * 2 / h.n; segs.push([h.x, h.y, h.x + Math.cos(a) * h.len, h.y + Math.sin(a) * h.len]) }
    return { segs, w: h.hw, ang: a0 }
  }
  if (h.k === 'ball') {
    const th = h.A * Math.sin(h.w * t + (h.ph || 0))
    return { bx: h.x + Math.sin(th) * h.L, by: h.y - Math.cos(th) * h.L, th, r: h.r }
  }
  if (h.k === 'piston') {   // 壁から出入りする杭
    const s = 0.5 - 0.5 * Math.cos(h.w * t + (h.ph || 0))
    const k = s * s * (3 - 2 * s)
    return { x: h.x + h.dx * k, y: h.y + h.dy * k, k }
  }
  return null
}
export function gustAt(g, t) {
  // 周期の duty の間だけ吹く。立ち上がりと止まりはなめらか
  const T = g.period, e = ((t + (g.ph || 0)) % T + T) % T
  const on = g.duty * T
  if (e > on) return 0
  const r = Math.min(e, on - e) / 0.5
  return Math.min(1, r)
}
export function floodLevel(W, S, i) {
  const f = W.floods[i], st = S.fl[i]
  if (st.start == null) return f.y0
  return Math.min(f.yMax, f.y0 + Math.max(0, S.t - st.start - (f.delay || 0)) * f.rate)
}

// ---------------------------------------------------------------- 状態
export function newState(W, at) {
  const sp = at || W.course.spawn
  return {
    t: 0, frame: 0,
    p: { x: sp.x, y: sp.y, vx: 0, vy: 0, ground: false, gnx: 0, gny: 1, stun: 0, face: 1 },
    rope: null,                 // {i, L, t}
    hookPrev: false, buf: 0, lastI: -1, lastT: -9,
    an: W.anchors.map(() => ({ crT: -1, fallT: 0, back: 0, used: false })),
    bell: {}, fl: W.floods.map(() => ({ start: null })),
    cp: -1, cpX: sp.x, cpY: sp.y, best: sp.y, falls: 0, grabs: 0, done: false, doneT: 0,
    ev: [],
  }
}
export function cloneState(S) {
  return {
    ...S, p: { ...S.p }, rope: S.rope ? { ...S.rope } : null,
    an: S.an.map(a => ({ ...a })), bell: { ...S.bell }, fl: S.fl.map(f => ({ ...f })), ev: [],
  }
}

// ---------------------------------------------------------------- 掛け点選び（画面の光る輪も同じ関数）
const _a = { x: 0, y: 0 }
export function losClear(W, S, ax, ay, bx, by) {
  for (const b0 of near(W.sBands, W.band, Math.min(ay, by), Math.max(ay, by))) {
    if (b0.noLos) continue
    const b = solidAt(W, S, b0)
    // 大まかに外れていれば飛ばす
    const rr = b.hw + b.hh
    const mx = (ax + bx) / 2, my = (ay + by) / 2, hl = Math.hypot(bx - ax, by - ay) / 2
    if (Math.abs(b.x - mx) > rr + hl || Math.abs(b.y - my) > rr + hl) continue
    if (segBox(ax, ay, bx, by, b, 0.06)) return false
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
// i 番の点に今掛けられるか。掛け点はプレイヤーが選ぶ（自動の照準はしない）
export function canGrab(W, S, i, from) {
  const a = W.anchors[i]; if (!a) return false
  if (!anchorUsable(W, S, a)) return false
  if (i === S.lastI && S.t - S.lastT < PH.regrab) return false
  const p = from || S.p
  const q = anchorPos(W, S, a, _a)
  const dx = q.x - p.x, dy = q.y - p.y
  if (dx * dx + dy * dy > PH.range * PH.range) return false
  return losClear(W, S, p.x, p.y, q.x, q.y)
}
// 届く距離の中で掛けられる点の一覧（画面で光らせる）
export function grabbable(W, S) {
  const out = [], p = S.p
  for (const a of near(W.aBands, W.band, p.y - PH.range - 1, p.y + PH.range + 1)) {
    if (Math.abs(a.x - p.x) > PH.range + 8 || Math.abs(a.y - p.y) > PH.range + 8) continue
    if (canGrab(W, S, a.i)) out.push(a.i)
  }
  return out
}

// ---------------------------------------------------------------- 1コマ
// inp: { pump: -1..1, hook: bool }
export function step(W, S, inp) {
  const h = PH.dt / PH.sub
  const p = S.p
  const hook = !!inp.hook
  // 押している間だけ掛かる。狙った点（inp.target）が届く所に入ったらその瞬間に掛かる
  if (!hook && S.rope) detach(W, S, false)
  if (hook && S.rope && inp.target != null && inp.target >= 0 && inp.target !== S.rope.i && !S.hookPrev) {
    // 掛けたまま別の点を押した: 掛け替え
    if (canGrab(W, S, inp.target)) { detach(W, S, false); attach(W, S, inp.target) }
  }
  if (hook && !S.rope && p.stun <= 0 && inp.target != null && inp.target >= 0 && canGrab(W, S, inp.target)) attach(W, S, inp.target)
  S.hookPrev = hook

  for (let k = 0; k < PH.sub; k++) substep(W, S, inp, h)

  // 掛け点の状態（崩れる・戻る）
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
  // 水位
  for (let i = 0; i < W.floods.length; i++) {
    const f = W.floods[i], st = S.fl[i]
    if (st.start == null && p.y > f.trigY && p.x > f.x0 && p.x < f.x1) { st.start = S.t; S.ev.push({ t: 'flood', i }) }
    if (st.start != null && p.y - PH.r * 0.5 < floodLevel(W, S, i) && p.x > f.x0 - 4 && p.x < f.x1 + 4) { S.ev.push({ t: 'drown', i }); respawn(W, S, true); return }
  }
  // 旗
  for (let i = 0; i < W.flags.length; i++) {
    const f = W.flags[i]
    if (i > S.cp && Math.abs(p.x - f.x) < (f.w || 3) / 2 + 0.2 && p.y > f.y - 0.2 && p.y < f.y + 2.4) {
      S.cp = i; S.cpX = f.x; S.cpY = f.y + 0.4; S.ev.push({ t: 'flag', i })
    }
  }
  if (p.y > S.best) S.best = p.y
  // 落ちすぎ
  if (p.y < S.cpY - PH.fallReset || p.y < W.bounds.y0) { S.ev.push({ t: 'fall' }); respawn(W, S, true); return }
  // 頂上
  if (!S.done && p.y > W.top.y && Math.abs(p.x - W.top.x) < W.top.w) { S.done = true; S.doneT = S.t; S.ev.push({ t: 'top' }) }
  S.t += PH.dt; S.frame++
}

function attach(W, S, i) {
  const a = W.anchors[i], p = S.p
  const q = anchorPos(W, S, a, _a)
  const d = Math.hypot(q.x - p.x, q.y - p.y)
  S.rope = { i, L: Math.max(PH.minLen, d), t: 0 }
  S.buf = 0; S.grabs++
  const st = S.an[i]
  if (a.kind === 'crumble' && st.crT < 0) st.crT = 0
  if (a.kind === 'bell') { S.bell[a.g] = S.t; S.ev.push({ t: 'bell', i, g: a.g }) }
  if (a.flag) { const k = W.flags.findIndex(f => f.a === i); if (k > S.cp) { const f = W.flags[k]; S.cp = k; S.cpX = f.x; S.cpY = f.y + 0.4; S.ev.push({ t: 'flag', i: k }) } }
  S.ev.push({ t: 'grab', i, d })
}
export function detach(W, S, forced) {
  const r = S.rope; if (!r) return
  const a = W.anchors[r.i]
  if (a.kind === 'rusty') { S.an[r.i].used = true; S.ev.push({ t: 'rustbreak', i: r.i }) }
  S.lastI = r.i; S.lastT = S.t
  S.rope = null
  S.ev.push({ t: 'release', i: r.i, forced, v: Math.hypot(S.p.vx, S.p.vy) })
}
export function respawn(W, S, fell) {
  if (S.rope) { S.rope = null }
  const p = S.p
  p.x = S.cpX; p.y = S.cpY; p.vx = p.vy = 0; p.stun = 0; p.ground = false
  if (fell) S.falls++
  for (const st of S.an) { st.used = false; st.crT = -1; st.fallT = 0; st.back = 0 }
  for (const f of S.fl) f.start = null
  S.bell = {}
  S.buf = 0; S.hookPrev = true   // 押しっぱなしのまま戻ってもすぐ掛からない
  S.ev.push({ t: 'respawn' })
}

const _q = { x: 0, y: 0 }
function substep(W, S, inp, h) {
  const p = S.p, t = S.t
  const u = cl(inp.pump || 0, -1, 1)
  p.stun = Math.max(0, p.stun - h)
  let ax = 0, ay = -PH.g
  // 突風
  for (const g of W.gusts) {
    if (p.x < g.x0 || p.x > g.x1 || p.y < g.y0 || p.y > g.y1) continue
    const k = gustAt(g, t)
    ax += g.fx * k; ay += (g.fy || 0) * k
  }
  const r = S.rope
  if (r) {
    r.t += h
    const a = W.anchors[r.i]
    const q = anchorPos(W, S, a, _q)
    const dx = p.x - q.x, dy = p.y - q.y, d = Math.hypot(dx, dy) || 1e-6
    // 真下からの角度と、右回りの接線
    const nx = dx / d, ny = dy / d
    const tx = -ny, ty = nx            // 反時計回り。右へ振れる向きは tx の符号で決める
    const th = Math.atan2(dx, -dy)     // 真下=0、右へ振れると +
    if (u !== 0 && d >= r.L - 0.05) {
      const vt = p.vx * tx + p.vy * ty
      // 右を押す = 右（+x）へ進む向きの接線へ力
      const sgn = tx >= 0 ? 1 : -1
      const want = u * sgn            // 接線のどちら向きへ押すか
      const absTh = Math.abs(th)
      const k = absTh < PH.pumpFull ? 1 : absTh > PH.pumpZero ? 0 : 1 - (absTh - PH.pumpFull) / (PH.pumpZero - PH.pumpFull)
      const same = want * vt >= 0
      let kk = k
      if (same) {
        // エネルギーから今の振れの最大角を出し、上限に近いほど弱める
        const v2 = p.vx * p.vx + p.vy * p.vy
        const c = Math.cos(th) - v2 / (2 * PH.g * r.L)
        const thMax = c <= -1 ? Math.PI : Math.acos(c > 1 ? 1 : c)
        kk *= cl((PH.ampCap - thMax) / 0.15, 0, 1)
      }
      const f = (same ? PH.pump * kk : PH.pumpBack) * Math.abs(u)
      ax += tx * want * f; ay += ty * want * f
    }
  } else if (!p.ground) {
    // 空中: 少しだけ寄せられる
    if (u !== 0 && (Math.sign(p.vx) !== Math.sign(u) || Math.abs(p.vx) < PH.airMaxVx)) ax += u * PH.airCtl
  }
  // 積分
  p.vx += ax * h; p.vy += ay * h
  if (p.ground && !r) {
    // 歩く。坂の向きに沿って
    const want = u * PH.walk
    const tgx = p.gny, tgy = -p.gnx    // 面に沿った右向き
    const vt = p.vx * tgx + p.vy * tgy
    const dv = cl(want - vt, -PH.walkAcc * h, PH.walkAcc * h)
    p.vx += tgx * dv; p.vy += tgy * dv
    if (u === 0) { const k = Math.max(0, 1 - 10 * h); p.vx = p.vx * k + 0; }
  }
  if (p.vy < -PH.maxFall) p.vy = -PH.maxFall
  p.x += p.vx * h; p.y += p.vy * h
  // ワイヤー（長さより遠くへ行けない）
  if (r) {
    const a = W.anchors[r.i]
    const q = anchorPos(W, S, a, _q)
    const dx = p.x - q.x, dy = p.y - q.y, d = Math.hypot(dx, dy)
    if (d > r.L) {
      const nx = dx / d, ny = dy / d
      p.x = q.x + nx * r.L; p.y = q.y + ny * r.L
      // 動く点の速さを考えた相対速度の、外向きを消す
      let avx = 0, avy = 0
      if (a.move || a.bellMove) { const q2 = anchorPos(W, { ...S, t: S.t + 1e-3 }, a, { x: 0, y: 0 }); avx = (q2.x - q.x) / 1e-3; avy = (q2.y - q.y) / 1e-3 }
      const rv = (p.vx - avx) * nx + (p.vy - avy) * ny
      if (rv > 0) { p.vx -= rv * nx; p.vy -= rv * ny }
    }
  }
  // 地形
  p.ground = false
  for (let it = 0; it < 2; it++) {
    for (const b0 of near(W.sBands, W.band, p.y - 1, p.y + 1)) {
      if (Math.abs(b0.x - p.x) > b0.hw + b0.hh + 3 && !b0.bell) continue
      const b = solidAt(W, S, b0)
      if (Math.abs(b.y - p.y) > b.hw + b.hh + 3) continue
      const c = circleBox(p.x, p.y, PH.r, b)
      if (!c) continue
      p.x += c.nx * c.d; p.y += c.ny * c.d
      const vn = p.vx * c.nx + p.vy * c.ny
      if (vn < 0) {
        p.vx -= vn * c.nx; p.vy -= vn * c.ny
        if (vn < -9) S.ev.push({ t: 'thud', v: -vn })
      }
      if (c.ny > 0.6) {
        p.ground = true; p.gnx = c.nx; p.gny = c.ny
        if (!r) { // 地面の摩擦（滑る面は弱く）
          const fr = b.slip ? 1.5 : 9
          const tx = c.ny, ty = -c.nx
          const vt = p.vx * tx + p.vy * ty
          if (inp.pump === 0 || !inp.pump) { const nv = vt * Math.max(0, 1 - fr * h); p.vx += (nv - vt) * tx; p.vy += (nv - vt) * ty }
        }
      }
    }
  }
  // 仕掛け
  if (p.stun <= 0) {
    for (const hz of near(W.hBands, W.band, p.y - 1, p.y + 1)) {
      if (Math.abs(hz.x - p.x) > (hz.reach || 12) || Math.abs(hz.y - p.y) > (hz.reach || 12)) continue
      const G = hazardGeo(hz, t)
      let hit = null, hvx = 0, hvy = 0
      if (hz.k === 'blade') {
        for (const s of G.segs) { const c = circleSeg(p.x, p.y, PH.r, s[0], s[1], s[2], s[3], G.w); if (c) { hit = c; const rx = c.qx - hz.x, ry = c.qy - hz.y; hvx = -ry * hz.w; hvy = rx * hz.w; break } }
      } else if (hz.k === 'ball') {
        const dx = p.x - G.bx, dy = p.y - G.by, d = Math.hypot(dx, dy)
        if (d < PH.r + G.r) {
          hit = { nx: dx / (d || 1), ny: dy / (d || 1), d: PH.r + G.r - d }
          const dth = hz.A * hz.w * Math.cos(hz.w * t + (hz.ph || 0))
          hvx = Math.cos(G.th) * hz.L * dth; hvy = Math.sin(G.th) * hz.L * dth
        }
      } else if (hz.k === 'piston') {
        const c = circleSeg(p.x, p.y, PH.r, hz.x - hz.dx * 0.2, hz.y - hz.dy * 0.2, G.x, G.y, hz.hw)
        if (c) { hit = c; const e = 0.5 * Math.sin(hz.w * t + (hz.ph || 0)) * hz.w; hvx = hz.dx * e; hvy = hz.dy * e }
      }
      if (hit) {
        p.x += hit.nx * hit.d; p.y += hit.ny * hit.d
        const kick = hz.kick || 9
        p.vx = hvx * 0.8 + hit.nx * kick; p.vy = hvy * 0.8 + hit.ny * kick * 0.6 + 2
        p.stun = PH.stun
        if (S.rope) detach(W, S, true)
        S.ev.push({ t: 'hit', k: hz.k })
        break
      }
    }
  }
  if (p.vx > 0.3) p.face = 1; else if (p.vx < -0.3) p.face = -1
}

// 振り子の今の振れ（真下からの角度と、振れの最大角の見積もり）。画面の補助と bot が使う
export function swingInfo(W, S) {
  const r = S.rope; if (!r) return null
  const q = anchorPos(W, S, W.anchors[r.i], { x: 0, y: 0 })
  const dx = S.p.x - q.x, dy = S.p.y - q.y
  const th = Math.atan2(dx, -dy)
  const v2 = S.p.vx * S.p.vx + S.p.vy * S.p.vy
  // エネルギーから振れの最大角（cos θm = cos θ - v²/(2gL)）
  const c = Math.cos(th) - v2 / (2 * PH.g * r.L)
  const thMax = c <= -1 ? Math.PI : Math.acos(Math.max(-1, Math.min(1, c)))
  return { th, thMax, L: r.L, ax: q.x, ay: q.y }
}
