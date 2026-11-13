// 掛け点のグラフ（人の速さの条件つき）を作り、届かない点・旗・頂上への道を出す。地図を shots/graph.svg に描く
import { writeFileSync, mkdirSync } from 'node:fs'
import { makeCourse } from '../js/course.js'
import { buildWorld, PH } from '../js/physics.js'
import { exploreAll, pathTo } from '../js/explore.js'
import { createHash } from 'node:crypto'
const C = makeCourse(), W = buildWorld(C)
const fi = process.argv.indexOf('--flag'); const FL = fi > 0 ? +process.argv[fi + 1] : -1
const R = exploreAll(W, FL >= 0 ? { at: { x: W.flags[FL].x, y: W.flags[FL].y + 0.4 } } : {})
const un = W.anchors.filter(a => !R.reached.has(a.i)).map(a => a.i)
let best = null
for (const n of R.nodes.values()) if (!best || n.y > best.y) best = n
console.log('nodes', R.nodes.size, 'edges', R.edges.length, 'ms', R.ms)
console.log('reached', R.reached.size, '/', W.anchors.length, 'unreached', JSON.stringify(un))
const flagsHit = W.flags.map((f, i) => R.reached.has(f.a) ? i : null).filter(v => v != null)
console.log('flags stood on', JSON.stringify(flagsHit), 'of', W.flags.length)
console.log('best y', best.y.toFixed(1), 'path', pathTo(best).map(n => n.i >= 0 ? n.i : 's(' + Math.round(n.S.p.x) + ',' + Math.round(n.S.p.y) + ')').join(' > '))
// 各点から出る枝の数と窓の広さ
const out = {}
for (const e of R.edges) { (out[e.a] ||= []).push(e.b + '(' + e.win + ')') }
if (process.argv.includes('-v')) for (const k of Object.keys(out)) console.log(k, '->', [...new Set(out[k])].join(' '))
// 地図
const xs = [...C.solids.map(s => s.x), ...C.anchors.map(a => a.x)], ys = [...C.solids.map(s => s.y), ...C.anchors.map(a => a.y)]
const x0 = Math.min(...xs) - 10, x1 = Math.max(...xs) + 10, y0 = Math.min(...ys) - 6, y1 = Math.max(...ys) + 8
const S = 10, Wd = (x1 - x0) * S, Ht = (y1 - y0) * S
const X = x => ((x - x0) * S).toFixed(1), Y = y => ((y1 - y) * S).toFixed(1)
let g = `<svg xmlns="http://www.w3.org/2000/svg" width="${Wd}" height="${Ht}" style="background:#1d2226;font:11px sans-serif">`
for (let yy = Math.ceil(y0 / 10) * 10; yy < y1; yy += 10) g += `<line x1="0" x2="${Wd}" y1="${Y(yy)}" y2="${Y(yy)}" stroke="#2c3338"/><text x="2" y="${Y(yy) - 2}" fill="#567">${yy}</text>`
for (const s of W.solids) g += `<rect x="${X(s.x0)}" y="${Y(s.y1)}" width="${(s.x1 - s.x0) * S}" height="${(s.y1 - s.y0) * S}" fill="${s.mat === 'wood' ? '#6a5236' : '#6b6f70'}" transform="rotate(${-(s.a || 0) * 57.3} ${X(s.x)} ${Y(s.y)})"/>`
const drawn = new Set()
for (const e of R.edges) { const k = e.a + '-' + e.b; if (drawn.has(k) || e.a < 0) continue; drawn.add(k); const a = W.anchors[e.a], b = W.anchors[e.b]; g += `<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(b.x)}" y2="${Y(b.y)}" stroke="${e.win > 12 ? '#3c8' : '#c93'}" stroke-opacity=".55" stroke-width="1.5" marker-end=""/>` }
for (const f of W.flags) g += `<path d="M${X(f.x)} ${Y(f.y)} v-26 l14 5 l-14 5" stroke="#eec" fill="#dcb755"/>`
for (const a of W.anchors) {
  const col = { ring: '#ddd', crumble: '#e96', rusty: '#b74', bell: '#fd5' }[a.kind] || '#ddd'
  g += `<circle cx="${X(a.x)}" cy="${Y(a.y)}" r="${PH.range * S}" fill="none" stroke="${col}" stroke-opacity=".07"/>`
  g += `<circle cx="${X(a.x)}" cy="${Y(a.y)}" r="5" fill="${R.reached.has(a.i) ? col : '#f33'}"/><text x="${+X(a.x) + 7}" y="${+Y(a.y) - 5}" fill="#cde">${a.i}</text>`
}
for (const h of W.hazards) g += `<circle cx="${X(h.x)}" cy="${Y(h.y)}" r="${(h.len || h.L || 2) * S}" fill="#f44" fill-opacity=".12" stroke="#f66"/>`
for (const gg of W.gusts) g += `<rect x="${X(gg.x0)}" y="${Y(gg.y1)}" width="${(gg.x1 - gg.x0) * S}" height="${(gg.y1 - gg.y0) * S}" fill="#8cf" fill-opacity=".08" stroke="#8cf" stroke-dasharray="4 4"/>`
const sp = pathTo(best).filter(n => n.S)
g += `<polyline fill="none" stroke="#7cf" stroke-width="2.5" points="${sp.map(n => X(n.S.p.x) + ',' + Y(n.S.p.y)).join(' ')}"/>`
g += '</svg>'
mkdirSync('shots', { recursive: true }); writeFileSync('shots/graph' + (FL >= 0 ? '_f' + FL : '') + '.svg', g)
console.log('map shots/graph.svg', Wd, 'x', Ht)

// bot 用に枝を保存（コースの中身の指紋つき）
const hash = createHash('md5').update(JSON.stringify(C)).digest('hex').slice(0, 10)
const topA = [], standEdges = []
for (const n of R.nodes.values()) {
  if (!n.S.rope && n.prev && n.prev.i >= 0 && n.S.p.y > W.top.y - 0.5 && Math.abs(n.S.p.x - W.top.x) < W.top.w) topA.push(n.prev.i)
  if (n.S.rope && n.prev && !n.prev.S.rope && n.prev.prev && n.prev.prev.i >= 0) standEdges.push([n.prev.prev.i, n.i])
}
writeFileSync('shots/edges_' + (FL >= 0 ? FL : 's') + '.json', JSON.stringify({ hash, edges: R.edges.map(e => [e.a, e.b, e.win]), topA: [...new Set(topA)], standEdges, reached: [...R.reached] }))
console.log('hash', hash, 'top-landing', [...new Set(topA)].join(','))
