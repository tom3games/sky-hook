// 部分の探索: A にぶら下がって止まった状態（長さ L）から、maxNodes 個まで BFS して届いた点を出す
// node tools/sub.mjs A L [maxNodes]
import { makeCourse } from '../js/course.js'
import { buildWorld, newState, step } from '../js/physics.js'
import { exploreAll, pathTo } from '../js/explore.js'
const W = buildWorld(makeCourse())
const [A, L, M] = [+process.argv[2], +(process.argv[3] || 4), +(process.argv[4] || 40)]
const S = newState(W); S.cpY = -1e9
const a = W.anchors[A]; S.p.x = a.x + 0.01; S.p.y = a.y - L
step(W, S, { hook: true, target: A, pump: 0 })
const R = exploreAll(W, { S0: S, maxNodes: M })
console.log('from', A, 'L', L, 'reached', [...R.reached].sort((x, y) => x - y).join(','))
let best = null; for (const n of R.nodes.values()) if (!best || n.y > best.y) best = n
console.log('best path', pathTo(best).map(n => n.i).join(' > '))
