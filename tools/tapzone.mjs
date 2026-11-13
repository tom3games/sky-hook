import '../mute-auto.mjs'
// 狙いの判定の広さ: 届く輪の画面の位置から 8 方向に 0〜90px ずらして押した時、その輪が選ばれる割合
import { chromium } from 'playwright'
process.env.PORT = String(5500 + Math.floor(Math.random() * 400))
await import('../server.mjs')
const br = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
for (const [w, h, touch] of [[390, 844, true], [1280, 720, false]]) {
  const p = await (await br.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch })).newPage()
  await p.goto(`http://localhost:${process.env.PORT}/?play=1`); await p.waitForFunction('window.__hookReady')
  const rows = []
  for (const fl of [0, 2, 4]) {
    await p.evaluate(f => hook.warpFlag(f), fl); await p.waitForTimeout(700)
    const r = await p.evaluate(() => {
      const out = {}
      for (const i of hook.grabbable()) {
        const a = hook.anchorXY(i)
        for (const d of [0, 20, 30, 40, 50, 60, 75, 90]) {
          let ok = 0
          for (let k = 0; k < 8; k++) { const t = k * Math.PI / 4; if (hook.pickAt(a.x + Math.cos(t) * d, a.y + Math.sin(t) * d) === i) ok++ }
          out[d] = (out[d] || 0) + ok / 8
        }
        out.n = (out.n || 0) + 1
      }
      return out
    })
    rows.push(r)
  }
  const sum = {}; let n = 0
  for (const r of rows) { n += r.n || 0; for (const k in r) if (k !== 'n') sum[k] = (sum[k] || 0) + r[k] }
  console.log(`${w}x${h}`, 'rings', n, Object.entries(sum).map(([d, v]) => d + 'px:' + Math.round(v / n * 100) + '%').join(' '))
}
await br.close(); process.exit(0)
