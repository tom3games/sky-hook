// 1つの掛け点から、こいで離して次の掛け点に届く範囲を測る（設計用）
import { PH, buildWorld, newState, step, cloneState, swingInfo } from '../js/physics.js'
const L = +(process.argv[2] || 6); if (process.argv[3]) PH.ampCap = +process.argv[3]; if (process.argv[4]) PH.range = +process.argv[4]
const course = { solids: [{ x: 0, y: -40, w: 400, h: 2 }], anchors: [{ x: 0, y: 0 }], hazards: [], gusts: [], flags: [], floods: [], top: { x: 0, y: 1e9, w: 1 }, bounds: { y0: -1e9 }, spawn: { x: 0, y: -L } }
const W = buildWorld(course)
let S = newState(W); S.cpY = 0
PH.fallReset = 1e9
S.p.x = 0.01; S.p.y = -L
// 掛ける
step(W, S, { hook: true, target: 0, pump: 0 })
let tAmp = {}, best = {}
const grid = new Map()
for (let f = 0; f < 60 * 12; f++) {
  const si = swingInfo(W, S)
  const vt = S.p.vx
  const pump = vt >= 0 ? 1 : -1
  // ここで離したら?
  const C = cloneState(S); C.cpY = 0
  step(W, C, { hook: false, pump: 0 })
  let peak = -1e9, px = 0
  for (let k = 0; k < 180; k++) { step(W, C, { hook: false, pump: Math.sign(C.p.vx) }); if (C.p.y > peak) { peak = C.p.y; px = C.p.x }
    // 届く格子
    for (let gx = -16; gx <= 16; gx += 1) for (let gy = -2; gy <= 14; gy += 1) {
      const dx = gx - C.p.x, dy = gy - C.p.y
      if (dy > -1 && dx * dx + dy * dy <= PH.range * PH.range) { const key = gx + ',' + gy; if (!grid.has(key)) grid.set(key, (f / 60).toFixed(1)) }
    }
  }
  const deg = Math.round(si.thMax * 57.3)
  for (const m of [60, 80, 90, 100, 110, 120]) if (deg >= m && tAmp[m] == null) tAmp[m] = (f / 60).toFixed(2)
  if (f % 30 === 0) console.log('t', (f / 60).toFixed(1), 'thMax', deg, 'peakIfRelease', peak.toFixed(2), 'at x', px.toFixed(1))
  step(W, S, { hook: true, target: 0, pump })
}
console.log('amp reached', tAmp)
// 届く範囲の地図（最初に届いた時刻）
for (let gy = 14; gy >= -2; gy--) { let row = (gy + '').padStart(3) + ' '; for (let gx = -16; gx <= 16; gx++) row += grid.has(gx + ',' + gy) ? (gy === 0 && gx === 0 ? 'O' : '#') : '.'; console.log(row) }
