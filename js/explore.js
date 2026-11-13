// 掛け点のグラフを探索する（人の速さの条件つき）。node の検査と bot が使う。
// 節点 = 「i 番の点にぶら下がった状態」または「棚に立った状態」。
// 枝 = こぐ → ある瞬間に離す → 飛ぶ → 届く所に入った点に掛ける（離してから react 秒より後だけ）。
// 離す瞬間の前後 tol コマずらしても同じ点に掛かる時だけ「人にできる」枝として数える。
import { PH, newState, cloneState, step, canGrab, anchorPos, near as nearBand } from './physics.js'

// 戻された（水位・落下）か、仕掛けに当たった
function dead(S) { for (const e of S.ev) if (e.t === 'respawn' || e.t === 'hit') return true; S.ev.length = 0; return false }

// rel（離すコマ）は「待った回数 k × 10000 ＋ 掛けてからのコマ」。k 回 0.9 秒ずつこがずに待ってからこぐ
export const WAIT_F = 54
export const HUMAN = { react: 0.22, tol: 3, maxHang: 7.0, relStep: 2, flight: 2.6 }

// ぶら下がった状態 S（rope あり）から、離す時刻ごとに飛んで掛かれる点を全部出す
export function expandHang(W, S0, opt = {}) {
  const H = { ...HUMAN, ...opt }
  const from = S0.rope.i
  const res = new Map()          // j -> [{rel, grabF, S}]
  const lands = []
  const nRel = Math.round(H.maxHang * 60)
  // まずぶら下がったまま、こぎ続けた道筋を記録（離す時刻の候補）。
  // 近くに動く仕掛けがある時は「少し待ってからこぐ」道筋も作る（人は羽根や鉄球が過ぎるのを待てる）
  const snaps = []
  const hz = nearBand(W.hBands, W.band, S0.p.y - 12, S0.p.y + 12).some(h => Math.abs(h.x - S0.p.x) < 14)
  const waits = hz ? [0, 1, 2] : [0]
  for (const k of waits) {
    const S = cloneState(S0)
    const wf = Math.round(k * 0.9 * 60)
    for (let f = 0; f <= nRel; f++) {
      if (!S.rope) break
      if (f % H.relStep === 0 && f >= wf) snaps.push({ f: k * 10000 + f, S: cloneState(S) })
      const vt = S.p.vx
      step(W, S, { hook: true, target: from, pump: f < wf ? 0 : (vt >= 0 ? 1 : -1) })
      if (dead(S)) break
    }
  }
  for (const sn of snaps) {
    const hit = flyFrom(W, sn.S, from, H)
    for (const [j, g] of hit.grabs) {
      if (!res.has(j)) res.set(j, [])
      res.get(j).push({ rel: sn.f, ...g })
    }
    if (hit.land) lands.push({ rel: sn.f, ...hit.land })
  }
  return { grabs: res, lands }
}

// 離してから飛ぶ。掛けられる点の最初の瞬間（react より後）を記録。棚に降りたらそこで止める
export function flyFrom(W, S0, from, H = HUMAN) {
  const S = cloneState(S0)
  S.cpY = -1e9
  const grabs = new Map()       // j -> 最初に届いた瞬間（長いワイヤー）
  const near = new Map()        // j -> 一番近づいた瞬間（短いワイヤー）
  let land = null
  const y0 = S.p.y
  step(W, S, { hook: false, pump: 0 })
  const nF = Math.round(H.flight * 60), rf = Math.round(H.react * 60)
  for (let f = 1; f < nF; f++) {
    if (f >= rf) {
      for (const a of nearBand(W.aBands, W.band, S.p.y - PH.range - 1, S.p.y + PH.range + 1)) {
        if (a.i === from) continue
        if (Math.abs(a.x - S.p.x) > PH.range + 4 || Math.abs(a.y - S.p.y) > PH.range + 4) continue
        if (!canGrab(W, S, a.i)) continue
        const q = anchorPos(W, S, a, { x: 0, y: 0 }), d = Math.hypot(q.x - S.p.x, q.y - S.p.y)
        if (!grabs.has(a.i) || (near.has(a.i) ? d < near.get(a.i).d : d < grabs.get(a.i).d - 1.2)) {
          const G = cloneState(S)
          step(W, G, { hook: true, target: a.i, pump: 0 })
          if (!dead(G) && G.rope && G.rope.i === a.i) {
            if (!grabs.has(a.i)) grabs.set(a.i, { f, S: G, d })
            else near.set(a.i, { f, S: G, d })
          }
        }
      }
    }
    step(W, S, { hook: false, pump: 0 })
    if (dead(S)) break
    if (S.p.ground && S.p.vy > -0.5 && Math.abs(S.p.vx) < 3) { land = { x: S.p.x, y: S.p.y, S: cloneState(S) }; break }
    if (S.p.y < y0 - 16) break
  }
  // 近い方は 1.2m 以上短い時だけ別の枝にする
  for (const [j, g] of near) if (grabs.get(j).d - g.d > 1.2) grabs.set(j + 0.5, { ...g, j })
  return { grabs, land }
}

// 棚に立った状態から: 歩いて届く所で掛けられる点
export function expandStand(W, S0, opt = {}) {
  const res = new Map()
  for (const dir of [-1, 1]) {
    const S = cloneState(S0); S.cpY = -1e9
    for (let f = 0; f < 60 * 6; f++) {
      for (const a of nearBand(W.aBands, W.band, S.p.y - PH.range - 1, S.p.y + PH.range + 1)) {
        if (res.has(a.i)) continue
        if (Math.abs(a.x - S.p.x) > PH.range + 1 || Math.abs(a.y - S.p.y) > PH.range + 1) continue
        if (canGrab(W, S, a.i)) {
          const G = cloneState(S)
          step(W, G, { hook: true, target: a.i, pump: 0 })
          if (G.rope) res.set(a.i, [{ rel: 0, f, walk: dir, S: G }])
        }
      }
      step(W, S, { hook: false, pump: dir })
      if (!S.p.ground) break
    }
  }
  return res
}

// 人にできる枝か: 離す時刻 rel の前後 tol コマで同じ j に掛かるか
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

// 全体の探索（BFS）。返り値: 届いた点・節点・各点への最初の道
export function exploreAll(W, opt = {}) {
  const H = { ...HUMAN, ...opt }
  const S0 = opt.S0 || newState(W, opt.at); S0.cpY = -1e9
  const key = (S) => S.rope ? 'h' + S.rope.i + ':' + Math.round(S.rope.L * 2) : 's' + Math.round(S.p.x) + ':' + Math.round(S.p.y)
  const seen = new Map()
  const queue = []
  const push = (S, prev, how) => {
    const k = key(S); if (seen.has(k)) return
    const n = { k, S, prev, how, i: S.rope ? S.rope.i : -1, y: S.p.y }
    seen.set(k, n); queue.push(n)
  }
  // 出発: 立った状態で始める（数コマ落ち着かせる）
  if (!opt.S0) for (let f = 0; f < 20; f++) step(W, S0, { hook: false, pump: 0 })
  push(S0, null, 'start')
  const reached = new Set()
  const edges = []
  let qi = 0
  const t0 = Date.now()
  while (qi < queue.length) {
    const n = queue[qi++]
    if (opt.maxNodes && qi > opt.maxNodes) break
    if (n.S.rope) {
      reached.add(n.S.rope.i)
      const ex = expandHang(W, n.S, H)
      for (const [j, list] of ex.grabs) {
        const wins = robustWindows(list, H.tol, H.relStep)
        if (!wins.length) continue
        // 一番広い窓の真ん中で離す
        wins.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))
        const mid = Math.round((wins[0][0] + wins[0][1]) / 2 / H.relStep) * H.relStep
        const e = list.reduce((b, x) => Math.abs(x.rel - mid) < Math.abs(b.rel - mid) ? x : b)
        edges.push({ a: n.i, b: Math.floor(j), win: wins[0][1] - wins[0][0], rel: e.rel })
        push(e.S, n, { rel: e.rel, to: Math.floor(j), win: wins[0][1] - wins[0][0] })
      }
      // 棚に降りる（落ちて別の棚へ）
      const lseen = new Set()
      for (const l of ex.lands) {
        const k = Math.round(l.x) + ':' + Math.round(l.y)
        if (lseen.has(k)) continue; lseen.add(k)
        push(l.S, n, { rel: l.rel, land: true })
      }
    } else {
      const ex = expandStand(W, n.S, H)
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
