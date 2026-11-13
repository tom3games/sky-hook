// 隣り合う番号の輪（a → a+1）が、ぶら下がって止まった状態（L=4 と 5.5）から振って届くかを一覧にする（設計の目安）
import { makeCourse } from '../js/course.js'
import { buildWorld, newState, step } from '../js/physics.js'
import { expandHang } from '../js/explore.js'
const W = buildWorld(makeCourse())
const [i0, i1] = [+(process.argv[2] || 0), +(process.argv[3] || W.anchors.length - 1)]
for (let A = i0; A < i1; A++) {
  const res = []
  for (const L of [4, 5.5]) {
    const S = newState(W); S.cpY = -1e9
    const a = W.anchors[A]; S.p.x = a.x + 0.01; S.p.y = a.y - L
    step(W, S, { hook: true, target: A, pump: 0 })
    if (!S.rope) { res.push('L' + L + ':nohang'); continue }
    const ex = expandHang(W, S)
    res.push('L' + L + ':' + [...new Set([...ex.grabs.keys()].map(Math.floor))].sort((x, y) => x - y).join(','))
  }
  const ok = res.some(r => r.split(':')[1].split(',').map(Number).includes(A + 1))
  const a = W.anchors[A], b = W.anchors[A + 1]
  console.log((ok ? '   ' : 'NG '), A, '->', A + 1, `(${b.x - a.x},${(b.y - a.y).toFixed(1)}) ${b.kind}${b.flag ? ' FLAG' : ''}`, res.join('  '))
}
