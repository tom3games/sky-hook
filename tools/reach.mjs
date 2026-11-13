// 掛け点の届く範囲の表: 区間ごとに、輪の数・8m 以内に見える輪の数・振って届く輪の数（グラフの枝）・罠（頂上へ道のない輪）
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { makeCourse } from '../js/course.js'
import { buildWorld, PH } from '../js/physics.js'
const C = makeCourse(), W = buildWorld(C)
const hash = createHash('md5').update(JSON.stringify(C)).digest('hex').slice(0, 10)
const out = new Map(), adj = new Map(), topA = new Set()
for (const f of readdirSync('shots').filter(f => /^edges_.*\.json$/.test(f))) {
  const d = JSON.parse(readFileSync('shots/' + f, 'utf8')); if (d.hash !== hash) continue
  for (const [a, b] of [...d.edges, ...d.standEdges]) { if (a < 0) continue; if (!out.has(a)) out.set(a, new Set()); out.get(a).add(b); if (!adj.has(b)) adj.set(b, new Set()); adj.get(b).add(a) }
  for (const t of d.topA) topA.add(t)
}
const dist = new Map(); const q = [...topA]; for (const a of q) dist.set(a, 1)
for (let k = 0; k < q.length; k++) for (const p of (adj.get(q[k]) || [])) if (!dist.has(p)) { dist.set(p, dist.get(q[k]) + 1); q.push(p) }
console.log('| 区間 | 輪 | 8m以内に見える輪（平均） | 振って届く輪（平均・最小） | 頂上へ道のない輪（罠・行き止まり） | 道の手数 |')
console.log('|---|---|---|---|---|---|')
for (const s of C.sections) {
  const as = W.anchors.filter(a => a.y >= s.y0 && a.y < s.y1)
  const vis = as.map(a => W.anchors.filter(b => b !== a && Math.hypot(b.x - a.x, b.y - a.y) <= PH.range).length)
  const sw = as.map(a => (out.get(a.i) || new Set()).size)
  const dead = as.filter(a => !dist.has(a.i)).map(a => a.i)
  const ds = as.filter(a => dist.has(a.i)).map(a => dist.get(a.i))
  const steps = ds.length ? Math.max(...ds) - Math.min(...ds) + 1 : '-'
  const avg = l => (l.reduce((x, y) => x + y, 0) / Math.max(1, l.length)).toFixed(1)
  console.log(`| ${s.key} | ${as.length} | ${avg(vis)} | ${avg(sw)}・${Math.min(...sw)} | ${dead.join(',') || 'なし'} | ${steps} |`)
}
console.log('全体: 頂上へ道のある輪', dist.size, '/', W.anchors.length, '・スタートから頂上までの最短手数', Math.max(...[0, 1, 2].map(i => dist.get(i) || 0)))
