// 1本の枝を調べる: A にぶら下がった状態（長さ L）から B に届くか。届かない時は一番近づいた距離と、線が通るかを出す
// node tools/edge.mjs A B [L...]
import { makeCourse } from '../js/course.js'
import { buildWorld, newState, step, cloneState, canGrab, anchorPos, losClear, PH } from '../js/physics.js'
import { expandHang } from '../js/explore.js'
const W = buildWorld(makeCourse())
const [A, B, ...Ls] = process.argv.slice(2).map(Number)
for (const L of (Ls.length ? Ls : [4, 5.5, 7])) {
  const S = newState(W); S.cpY = -1e9
  const a = W.anchors[A]
  S.p.x = a.x + 0.01; S.p.y = a.y - L; S.p.vx = 0; S.p.vy = 0
  step(W, S, { hook: true, target: A, pump: 0 })
  if (!S.rope) { console.log('L', L, 'cannot hang (blocked?)'); continue }
  const ex = expandHang(W, S)
  const got = [...ex.grabs.keys()].map(k => Math.floor(k))
  // B への一番近い距離（離す時刻を全部）
  let best = 1e9, bestLos = false, at = null
  for (let rel = 0; rel < 420; rel += 3) {
    const C = cloneState(S)
    for (let f = 0; f < rel && C.rope; f++) step(W, C, { hook: true, target: A, pump: C.p.vx >= 0 ? 1 : -1 })
    if (!C.rope) break
    step(W, C, { hook: false, pump: 0 })
    for (let f = 0; f < 150; f++) {
      step(W, C, { hook: false, pump: 0 })
      const q = anchorPos(W, C, W.anchors[B], { x: 0, y: 0 }), d = Math.hypot(q.x - C.p.x, q.y - C.p.y)
      if (d < best) { best = d; bestLos = losClear(W, C, C.p.x, C.p.y, q.x, q.y); at = [C.p.x.toFixed(1), C.p.y.toFixed(1), rel] }
    }
  }
  console.log('L', L, 'reach', [...new Set(got)].sort((x, y) => x - y).join(','), '| to', B, 'min dist', best.toFixed(2), 'los', bestLos, 'at', at, 'hang y', S.p.y.toFixed(1), 'ground', S.p.ground)
}
