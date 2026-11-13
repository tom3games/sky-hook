// 掛け点のグラフを探索する（3D・人の速さの条件つき）。node の検査と bot が使う。
// 節点 = 「i 番の点にぶら下がった状態」または「足場に立った状態」。
// 枝 = ある向きへこぐ → ある瞬間に離す → 飛ぶ → 届く所に入った点に掛ける（離してから react 秒より後だけ）。
// こぐ向きは「近くの輪の水平の向き」を 12 方位にまとめた物＋前後左右。振り子の面は自分で選ぶので、向きごとに道筋を作る。
// 離す瞬間の前後 tol コマずらしても同じ点に掛かる時だけ「人にできる」枝として数える。
import { PH, newState, cloneState, step, canGrab, anchorPos, near as nearBand } from './physics.js'

function dead(S) { for (const e of S.ev) if (e.t === 'respawn' || e.t === 'hit') return true; S.ev.length = 0; return false }

// rel（離すコマ）= ((向き番号 × 4 + 待った回数) × 10000) + 掛けてからのコマ
export const WAIT_F = 54
export const HUMAN = { react: 0.22, tol: 3, maxHang: 6.0, relStep: 2, flight: 2.6 }
export const NDIR = 12
export function dirOf(k) { if (k >= NDIR) return [[1, 0], [-1, 0], [0, 1], [0, -1]][k - NDIR]; const t = k / NDIR * Math.PI * 2; return [Math.cos(t), Math.sin(t)] }
export function decodeRel(rel) { const hk = Math.floor(rel / 10000); return { dir: Math.floor(hk / 4), wait: hk % 4, f: rel % 10000 } }
// こぐ入力: 決めた向き d の線の上で、今の速さの向きへ押す（前後にこぐ）
export function pumpInput(S, d, f, waitF) {
  if (f < waitF) return { mx: 0, mz: 0 }
  const s = S.p.vx * d[0] + S.p.vz * d[1] >= 0 ? 1 : -1
  return { mx: d[0] * s, mz: d[1] * s }
}

function headings(W, S) {
  const p = S.p, set = new Set()
  for (const a of nearBand(W.aBands, W.band, p.y - 6, p.y + 14)) {
    const dx = a.x - p.x, dz = (a.z || 0) - p.z, hd = Math.hypot(dx, dz)
    if (hd > 16 || hd < 0.5) continue
    let t = Math.atan2(dz, dx); if (t < 0) t += Math.PI * 2
    set.add(Math.round(t / (Math.PI * 2) * NDIR) % NDIR % (NDIR / 2))   // 反対向きは同じ線
  }
  set.add(0); set.add(NDIR / 4)   // 左右・前後は必ず
  return [...set]
}

export function expandHang(W, S0, opt = {}) {
  const H = { ...HUMAN, ...opt }
  const from = S0.rope.i
  const res = new Map(), lands = []
  const nRel = Math.round(H.maxHang * 60)
  const hz = nearBand(W.hBands, W.band, S0.p.y - 12, S0.p.y + 12).some(h => Math.abs(h.x - S0.p.x) < 14)
  const waits = hz ? [0, 1, 2] : [0]
  for (const dk of opt.dirs || headings(W, S0)) {
    const d = dirOf(dk)
    for (const k of waits) {
      const S = cloneState(S0)
      const wf = Math.round(k * 0.9 * 60)
      const base = (dk * 4 + k) * 10000
      for (let f = 0; f <= nRel; f++) {
        if (!S.rope) break
        if (f % H.relStep === 0 && f >= wf) {
          const hit = flyFrom(W, S, from, H)
          for (const [j, g] of hit.grabs) { if (!res.has(j)) res.set(j, []); res.get(j).push({ rel: base + f, ...g }) }
          if (hit.land) lands.push({ rel: base + f, ...hit.land })
        }
        step(W, S, { hook: true, target: from, ...pumpInput(S, d, f, wf) })
        if (dead(S)) break
      }
    }
  }
  return { grabs: res, lands }
}

export function flyFrom(W, S0, from, H = HUMAN) {
  const S = cloneState(S0)
  S.cpY = -1e9
  const grabs = new Map(), nearG = new Map()
  let land = null
  const y0 = S.p.y
  step(W, S, { hook: false })
  const nF = Math.round(H.flight * 60), rf = Math.round(H.react * 60)
  const q = { x: 0, y: 0, z: 0 }
  for (let f = 1; f < nF; f++) {
    if (f >= rf) {
      for (const a of nearBand(W.aBands, W.band, S.p.y - PH.range - 1, S.p.y + PH.range + 1)) {
        if (a.i === from) continue
        if (Math.abs(a.x - S.p.x) > PH.range + 4 || Math.abs((a.z || 0) - S.p.z) > PH.range + 4) continue
        if (!canGrab(W, S, a.i)) continue
        anchorPos(W, S, a, q)
        const d = Math.hypot(q.x - S.p.x, q.y - S.p.y, q.z - S.p.z)
        if (!grabs.has(a.i) || (nearG.has(a.i) ? d < nearG.get(a.i).d : d < grabs.get(a.i).d - 1.2)) {
          const G = cloneState(S)
          step(W, G, { hook: true, target: a.i })
          if (!dead(G) && G.rope && G.rope.i === a.i) {
            if (!grabs.has(a.i)) grabs.set(a.i, { f, S: G, d })
            else nearG.set(a.i, { f, S: G, d })
          }
        }
      }
    }
    step(W, S, { hook: false })
    if (dead(S)) break
    if (S.p.ground && S.p.vy > -0.5 && Math.hypot(S.p.vx, S.p.vz) < 3) { land = { x: S.p.x, y: S.p.y, z: S.p.z, S: cloneState(S) }; break }
    if (S.p.y < y0 - 16) break
  }
  for (const [j, g] of nearG) if (grabs.get(j).d - g.d > 1.2) grabs.set(j + 0.5, { ...g, j })
  return { grabs, land }
}

// 足場に立った状態から: 8 方向へ走って、届く所で掛けられる点（走り出して足場から落ちる所まで）
export function expandStand(W, S0) {
  const res = new Map()
  for (let k = 0; k < 8; k++) {
    const t = k / 8 * Math.PI * 2, mx = Math.cos(t), mz = Math.sin(t)
    const S = cloneState(S0); S.cpY = -1e9
    let air = 0
    for (let f = 0; f < 60 * 5; f++) {
      for (const a of nearBand(W.aBands, W.band, S.p.y - PH.range - 1, S.p.y + PH.range + 1)) {
        if (res.has(a.i) || Math.abs(a.x - S.p.x) > PH.range + 1) continue
        if (canGrab(W, S, a.i)) {
          const G = cloneState(S)
          step(W, G, { hook: true, target: a.i, mx, mz })
          if (G.rope) res.set(a.i, [{ rel: 0, f, walk: [mx, mz], S: G }])
        }
      }
      step(W, S, { hook: false, mx, mz })
      if (dead(S)) break
      if (!S.p.ground) { if (++air > 20) break } else air = 0
    }
  }
  return res
}

export function robustWindows(list, tol, relStep) {
  const rs = list.map(e => e.rel).sort((a, b) => a - b)
  const wins = []
  let s = rs[0], prev = rs[0]
  for (let k = 1; k <= rs.length; k++) {
    const r = rs[k]
    if (r === undefined || r - prev > relStep) { wins.push([s, prev]); s = r }
    prev = r
  }
  return wins.filter(w => w[1] - w[0] >= tol * 2)
}

export function exploreAll(W, opt = {}) {
  const H = { ...HUMAN, ...opt }
  const S0 = opt.S0 || newState(W, opt.at); S0.cpY = -1e9
  const key = (S) => S.rope ? 'h' + S.rope.i + ':' + Math.round(S.rope.L * 2) : 's' + Math.round(S.p.x) + ':' + Math.round(S.p.y) + ':' + Math.round(S.p.z)
  const seen = new Map(), queue = []
  let stopHit = false
  const push = (S, prev, how) => {
    const k = key(S); if (seen.has(k)) return
    const n = { k, S, prev, how, i: S.rope ? S.rope.i : -1, y: S.p.y }
    seen.set(k, n); queue.push(n)
    if (opt.stop && ((opt.stop.ring != null && S.rope && S.rope.i === opt.stop.ring) || (opt.stop.top && (S.done || (S.p.y > W.top.y - 0.5 && Math.abs(S.p.x - W.top.x) < W.top.w))))) stopHit = true
  }
  if (!opt.S0) for (let f = 0; f < 20; f++) step(W, S0, {})
  push(S0, null, 'start')
  const reached = new Set(), edges = []
  let qi = 0
  const t0 = Date.now()
  while (qi < queue.length) {
    const n = queue[qi++]
    if (opt.maxNodes && qi > opt.maxNodes) break
    if (stopHit) break
    if (n.S.rope) {
      reached.add(n.S.rope.i)
      const ex = expandHang(W, n.S, H)
      for (const [j, list] of ex.grabs) {
        const wins = robustWindows(list, H.tol, H.relStep)
        if (!wins.length) continue
        wins.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))
        const mid = Math.round((wins[0][0] + wins[0][1]) / 2 / H.relStep) * H.relStep
        const e = list.reduce((b, x) => Math.abs(x.rel - mid) < Math.abs(b.rel - mid) ? x : b)
        edges.push({ a: n.i, b: Math.floor(j), win: wins[0][1] - wins[0][0], rel: e.rel })
        push(e.S, n, { rel: e.rel, to: Math.floor(j), win: wins[0][1] - wins[0][0] })
      }
      const lseen = new Set()
      for (const l of ex.lands) {
        const k = Math.round(l.x) + ':' + Math.round(l.y) + ':' + Math.round(l.z)
        if (lseen.has(k)) continue; lseen.add(k)
        push(l.S, n, { rel: l.rel, land: true })
      }
    } else {
      const ex = expandStand(W, n.S)
      for (const [j, list] of ex) push(list[0].S, n, { walk: list[0].walk, f: list[0].f, to: j })
    }
  }
  return { reached, nodes: seen, edges, ms: Date.now() - t0 }
}

export function pathTo(n) {
  const out = []
  while (n) { out.push(n); n = n.prev }
  return out.reverse()
}
