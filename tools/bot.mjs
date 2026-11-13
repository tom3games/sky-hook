// 人の速さの bot で通しで登る。
//   node tools/bot.mjs [plan|straight|greedy] [seed] [--flag k]
// plan    : 掛け点のグラフ（tools/graph と同じ探索）から「頂上までの手数」を出し、毎回その場で探して一番近道の点を選ぶ。
//           離す瞬間は届く時刻の窓の真ん中 ± 人のぶれ（最大 3 コマ = 50ms）、掛けるのは離してから 0.22〜0.4 秒後
// straight: こがずに、一番真上に近い点だけに掛ける（巻き取り無しでは登れないことの確認）
// greedy  : 道を読まずに、届く中で一番高い点に掛ける
import { makeCourse } from '../js/course.js'
import { buildWorld, newState, step, cloneState, canGrab, anchorPos, PH, grabbable } from '../js/physics.js'
import { exploreAll, expandHang, expandStand, robustWindows, HUMAN } from '../js/explore.js'

const mode = process.argv[2] || 'plan'
const seed = +(process.argv[3] || 1)
const fi = process.argv.indexOf('--flag'); const FL = fi > 0 ? +process.argv[fi + 1] : -1
const W = buildWorld(makeCourse())
let rs = seed * 9301 + 49297
const rnd = () => { rs = (rs * 9301 + 49297) % 233280; return rs / 233280 }

// 頂上までの手数（逆向きの BFS）。tools/graph.mjs が出発と各旗から作った枝を全部まとめて使う
let distTop = null
if (mode === 'plan') {
  const { readFileSync, readdirSync } = await import('node:fs')
  const { createHash } = await import('node:crypto')
  const hash = createHash('md5').update(JSON.stringify(makeCourse())).digest('hex').slice(0, 10)
  const adj = new Map(), topA = new Set()
  let files = 0
  for (const f of readdirSync('shots').filter(f => /^edges_.*\.json$/.test(f))) {
    const d = JSON.parse(readFileSync('shots/' + f, 'utf8'))
    if (d.hash !== hash) { console.log('skip stale', f); continue }
    files++
    for (const [a, b] of [...d.edges, ...d.standEdges]) { if (a < 0) continue; if (!adj.has(b)) adj.set(b, new Set()); adj.get(b).add(a) }
    for (const t of d.topA) topA.add(t)
  }
  distTop = new Map()
  const q = [...topA]; for (const a of q) distTop.set(a, 1)
  for (let k = 0; k < q.length; k++) for (const p of (adj.get(q[k]) || [])) if (!distTop.has(p)) { distTop.set(p, distTop.get(q[k]) + 1); q.push(p) }
  console.log('edge files', files, 'anchors with a way to the top', distTop.size, '/', W.anchors.length)
}

let S = newState(W, FL >= 0 ? { x: W.flags[FL].x, y: W.flags[FL].y + 0.4 } : null)
if (FL >= 0) { S.cp = FL; S.cpX = W.flags[FL].x; S.cpY = W.flags[FL].y + 0.4 }
for (let f = 0; f < 20; f++) step(W, S, {})
let hops = 0, decisions = 0
const LIMIT = 60 * 60 * 40   // 40 分で打ち切り
const log = []
function run(inp, n) { for (let k = 0; k < n; k++) { step(W, S, inp); for (const e of S.ev) if (['fall', 'drown', 'hit', 'crumble', 'flag', 'top'].includes(e.t)) log.push((S.t).toFixed(1) + ' ' + e.t + (e.i != null ? e.i : '')); S.ev.length = 0; if (S.done) return } }
const recent = []
const score = j => {
  const base = mode === 'plan' ? (distTop.has(j) ? -distTop.get(j) : -1e6) + W.anchors[j].y * 0.01 : W.anchors[j].y
  // 最近いた点には戻りにくく（同じ所を回り続けない）
  const k = recent.lastIndexOf(j)
  return base - (k >= 0 ? (8 - (recent.length - 1 - k)) * 3 : 0) + rnd() * 0.5
}

let lastBest = -1e9, stall = 0
while (!S.done && S.frame < LIMIT) {
  if (S.p.y > lastBest + 1) { lastBest = S.p.y; stall = 0 } else stall++
  if (stall > 400) break
  decisions++
  if (S.rope) {
    const from = S.rope.i
    if (mode === 'straight') {
      // こがずに、真上に近い点へ
      const g = grabbable(W, S).filter(j => j !== from && W.anchors[j].y > W.anchors[from].y + 1)
      if (!g.length) break
      g.sort((a, b) => Math.abs(W.anchors[a].x - S.p.x) - Math.abs(W.anchors[b].x - S.p.x))
      run({ hook: false, pump: 0 }, 1); run({ hook: true, target: g[0], pump: 0 }, 90); hops++
      continue
    }
    const ex = expandHang(W, S)
    // 頂上の棚に降りられるなら降りる
    const topLand = ex.lands.find(l => l.y > W.top.y - 0.5 && Math.abs(l.x - W.top.x) < W.top.w)
    let best = null
    const opts = []
    for (const [jj, list] of ex.grabs) {
      const j = Math.floor(jj)
      const wins = robustWindows(list, HUMAN.tol, HUMAN.relStep)
      if (!wins.length) continue
      wins.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))
      opts.push({ j, near: jj !== j, sc: score(j) + (wins[0][1] - wins[0][0]) * 0.001, win: wins[0], list })
    }
    // 一手先まで読む（plan）: その点に掛かった後、さらに頂上へ近づけるか
    if (mode === 'plan') {
      opts.sort((a, b) => b.sc - a.sc)
      for (const o of opts.slice(0, 5)) {
        const mid = (o.win[0] + o.win[1]) / 2
        const e = o.list.reduce((b, x) => Math.abs(x.rel - mid) < Math.abs(b.rel - mid) ? x : b)
        if (!e.S.rope) { o.sc -= 1e5; continue }
        const ex2 = expandHang(W, e.S)
        let nb = -1e9
        for (const [kk, l2] of ex2.grabs) { const k = Math.floor(kk); if (k === from || !robustWindows(l2, HUMAN.tol, HUMAN.relStep).length) continue; nb = Math.max(nb, distTop.has(k) ? -distTop.get(k) : -1e6) }
        if (ex2.lands.some(l => l.y > W.top.y - 0.5 && Math.abs(l.x - W.top.x) < W.top.w)) nb = 0
        o.sc = Math.min(o.sc, nb + 1) + o.sc * 1e-3
      }
    }
    for (const o of opts) if (!best || o.sc > best.sc) best = o
    let rel, target
    if (topLand && (mode !== 'plan' || !best || true)) { rel = topLand.rel; target = -1 }
    else if (best && (mode !== 'plan' || distTop.has(best.j) || true)) {
      const mid = (best.win[0] + best.win[1]) / 2
      const jit = Math.round((rnd() * 2 - 1) * HUMAN.tol)
      rel = Math.max(0, Math.round(mid) + jit); target = best.j
      const e0 = best.list.reduce((b, x) => Math.abs(x.rel - mid) < Math.abs(b.rel - mid) ? x : b)
      best.grabD = best.near ? e0.d + 0.4 : 99
    } else { // どこにも行けない: 手を離して落ちる
      run({ hook: false, pump: 0 }, 60); continue
    }
    const wk = Math.floor(rel / 10000), rf = rel % 10000, wf = wk * 54
    for (let f = 0; f < rf && S.rope && !S.done; f++) run({ hook: true, target: from, pump: f < wf ? 0 : (S.p.vx >= 0 ? 1 : -1) }, 1)
    run({ hook: false, pump: 0 }, 1)
    if (target < 0) { run({ hook: false, pump: 0 }, 120); continue }
    // 離してから人の反応ぶん待ってから、狙った点を押しっぱなしにする
    const delay = Math.round((HUMAN.react + rnd() * 0.12) * 60)
    run({ hook: false, pump: 0 }, delay)
    let ok = false
    // 短いワイヤーで掛ける手は、十分近づいてから押す
    const gd = best && best.grabD || 99
    for (let f = 0; f < 150 && !S.done; f++) {
      const q = anchorPos(W, S, W.anchors[target], { x: 0, y: 0 })
      const press = Math.hypot(q.x - S.p.x, q.y - S.p.y) <= gd
      run({ hook: press, target, pump: 0 }, 1); if (S.rope && S.rope.i === target) { ok = true; break }
    }
    if (ok) { hops++; recent.push(target); if (recent.length > 8) recent.shift() }
    else run({ hook: false, pump: 0 }, 30)
  } else {
    // 立っている（出発・旗の足場・棚）: 歩いて届く点に掛け、崖から振り出す
    const ex = expandStand(W, S)
    let best = null
    for (const [j, list] of ex) { const sc = score(j); if (!best || sc > best.sc) best = { j, sc, e: list[0] } }
    if (!best) { run({ hook: false, pump: 0 }, 30); continue }
    run({ hook: false, pump: best.e.walk }, best.e.f)
    run({ hook: true, target: best.j, pump: best.e.walk }, 2)
    if (!S.rope) run({ hook: false, pump: 0 }, 10)
  }
}
const sec = W.course.sections.find(s => S.p.y >= s.y0 && S.p.y < s.y1)
console.log(JSON.stringify({ mode, seed, from: FL, done: S.done, time: +(S.done ? S.doneT : S.t).toFixed(1), falls: S.falls, hops, best: +S.best.toFixed(1), at: sec && sec.key, flag: S.cp }))
if (process.argv.includes('-v')) console.log(log.join('\n'))
