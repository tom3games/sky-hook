// 人の速さの bot で区間ごとに通す（旗から次の旗まで）。
//   node tools/route.mjs [seed] [区間 k（-1=出発から旗1）...]
// 1) その旗の足場から探索して、次の旗の輪（最後は頂上の棚）までの道（掛ける輪の順番）を出す
// 2) その順番どおりに、毎回その場で「離す時刻の窓」を探し直し、窓の真ん中 ± 人のぶれ（最大 3 コマ = 50ms）で離し、
//    離してから 0.22〜0.34 秒たってから次の輪を押す。落ちたら旗からやり直す（最大 4 回）
import { makeCourse } from '../js/course.js'
import { buildWorld, newState, step, anchorPos, cloneState } from '../js/physics.js'
import { exploreAll, expandHang, expandStand, robustWindows, HUMAN, pathTo } from '../js/explore.js'
const W = buildWorld(makeCourse())
const seed = +(process.argv[2] || 1)
const secs = process.argv.slice(3).map(Number)
let rs = seed * 7919 + 13
const rnd = () => { rs = (rs * 9301 + 49297) % 233280; return rs / 233280 }

function startState(k) {
  if (k < 0) { const S = newState(W); for (let f = 0; f < 20; f++) step(W, S, {}); return S }
  const f = W.flags[k]
  const S = newState(W, { x: f.x, y: f.y + 0.4 }); S.cp = k; S.cpX = f.x; S.cpY = f.y + 0.4
  for (let f2 = 0; f2 < 20; f2++) step(W, S, {})
  return S
}
const goalOf = k => k + 1 < W.flags.length ? { ring: W.flags[k + 1].a } : { top: true }
function reached(S, goal) { return goal.top ? S.done : (S.rope && S.rope.i === goal.ring) }

function planRoute(S0, goal, maxNodes = 3000) {
  const R = exploreAll(W, { S0: cloneState(S0), maxNodes, stop: goal })
  let best = null
  for (const n of R.nodes.values()) {
    const ok = goal.top ? (n.S.done || (n.S.p.y > W.top.y - 0.5 && Math.abs(n.S.p.x - W.top.x) < W.top.w)) : (n.S.rope && n.S.rope.i === goal.ring)
    if (ok && (!best || n.S.t < best.S.t)) best = n
  }
  if (!best) return null
  return pathTo(best).slice(1).map(n => ({ j: n.S.rope ? n.S.rope.i : -1, land: !n.S.rope, y: n.S.p.y, x: n.S.p.x, L: n.S.rope ? n.S.rope.L : 0 }))
}

function play(S, route, goal, depth = 0) {
  const replan = () => { if (process.env.V) console.log('  fail at', S.rope ? S.rope.i : 'air', '->', cur && cur.j, 't', S.t.toFixed(1)); if (depth >= 3) return false; const r2 = planRoute(S, goal, 600); if (!r2) return false; replans++; return play(S, r2, goal, depth + 1) }
  let cur = null
  for (const st of route) {
    cur = st
    if (reached(S, goal)) return true
    if (S.rope) {
      const from = S.rope.i
      const ex = expandHang(W, S)
      let list = null
      if (st.land) {
        const ls = ex.lands.filter(l => Math.abs(l.x - st.x) < 2.5 && Math.abs(l.y - st.y) < 1.5)
        if (!ls.length) return replan()
        const l = ls[Math.floor(ls.length / 2)]
        for (let f = 0; f < l.rel % 10000; f++) step(W, S, { hook: true, target: from, pump: f < Math.floor(l.rel / 10000) * 54 ? 0 : (S.p.vx >= 0 ? 1 : -1) })
        for (let f = 0; f < 150 && !S.done; f++) step(W, S, { hook: false, pump: 0 })
        continue
      }
      // 長さが近い枝を選ぶ（短く掛ける手は近づいてから押す）
      let pick = null
      for (const [jj, l2] of ex.grabs) {
        if (Math.floor(jj) !== st.j) continue
        const wins = robustWindows(l2, HUMAN.tol, HUMAN.relStep); if (!wins.length) continue
        wins.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))
        const mid = (wins[0][0] + wins[0][1]) / 2
        const e = l2.reduce((b, x) => Math.abs(x.rel - mid) < Math.abs(b.rel - mid) ? x : b)
        const sc = -Math.abs(e.S.rope.L - st.L) + (wins[0][1] - wins[0][0]) * 0.02
        if (!pick || sc > pick.sc) pick = { sc, mid, near: jj !== st.j, d: e.d }
      }
      if (!pick) return replan()
      const rel = Math.max(0, Math.round(pick.mid) + Math.round((rnd() * 2 - 1) * HUMAN.tol))
      const wk = Math.floor(rel / 10000), rf = rel % 10000
      for (let f = 0; f < rf && S.rope; f++) step(W, S, { hook: true, target: from, pump: f < wk * 54 ? 0 : (S.p.vx >= 0 ? 1 : -1) })
      step(W, S, { hook: false, pump: 0 })
      const delay = Math.round((HUMAN.react + rnd() * 0.12) * 60)
      for (let f = 0; f < delay; f++) step(W, S, { hook: false, pump: 0 })
      const gd = pick.near ? pick.d + 0.4 : 99
      let ok = false
      for (let f = 0; f < 150; f++) {
        const q = anchorPos(W, S, W.anchors[st.j], { x: 0, y: 0 })
        step(W, S, { hook: Math.hypot(q.x - S.p.x, q.y - S.p.y) <= gd, target: st.j, pump: 0 })
        if (S.rope && S.rope.i === st.j) { ok = true; break }
      }
      if (!ok) return replan()
    } else {
      const ex = expandStand(W, S)
      const e = ex.get(st.j); if (!e) return replan()
      for (let f = 0; f < e[0].f; f++) step(W, S, { hook: false, pump: e[0].walk })
      step(W, S, { hook: true, target: st.j, pump: e[0].walk }); step(W, S, { hook: true, target: st.j, pump: e[0].walk })
      if (!S.rope) return false
    }
    if (S.ev.some(e => e.t === 'respawn')) return false
    S.ev.length = 0
  }
  // 頂上: 最後の輪から棚に降りる
  for (let f = 0; f < 200 && !S.done && goal.top; f++) step(W, S, { hook: false, pump: 0 })
  return reached(S, goal)
}

const list = secs.length ? secs : [-1, 0, 1, 2, 3, 4, 5, 6]
let total = 0, allOk = true, replans = 0
for (const k of list) {
  const goal = goalOf(k)
  const S0 = startState(k)
  const t0 = Date.now()
  const route = planRoute(S0, goal)
  if (!route) { console.log(JSON.stringify({ sec: k, ok: false, why: 'no route found', ms: Date.now() - t0 })); allOk = false; continue }
  let ok = false, tries = 0, simT = 0
  while (!ok && tries < 4) {
    tries++
    const S = cloneState(S0); S.t = 0
    S.ev = []
    ok = play(S, route, goal)
    simT += S.t
  }
  total += simT
  if (!ok) allOk = false
  console.log(JSON.stringify({ sec: k, ok, tries, replans, hops: route.filter(r => !r.land).length, simT: +simT.toFixed(1), route: route.map(r => r.land ? 'land' : r.j).join('>'), ms: Date.now() - t0 }))
}
console.log(JSON.stringify({ seed, allOk, totalSec: +total.toFixed(1) }))
