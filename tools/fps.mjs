import '../mute-auto.mjs'
// 60fps の確認: GPU（Metal）で開き、振っている最中の fps を 5 秒数える
import { chromium } from 'playwright'
process.env.PORT = String(5500 + Math.floor(Math.random() * 400))
await import('../server.mjs')
const br = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
for (const [w, h, q] of [[1280, 720, 'high'], [390, 844, 'mid']]) {
  const p = await (await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 3 : 1 })).newPage()
  await p.goto(`http://localhost:${process.env.PORT}/?play=1&q=${q}`); await p.waitForFunction('window.__hookReady')
  const gpu = await p.evaluate(() => { const g = document.querySelector('#view canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?' })
  await p.evaluate(() => { hook.warpFlag(3); hook.DBG.bot = { hook: true, target: hook.W.flags[3].a, pump: 1 }; hook.DBG.onStep = S => { hook.DBG.bot.pump = S.p.vx >= 0 ? 1 : -1 } })
  await p.waitForTimeout(2000)
  const fps = await p.evaluate(() => new Promise(r => { let n = 0, t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(f); else r(n / 5) }; requestAnimationFrame(f) }))
  console.log(`${w}x${h} q=${q}`, 'fps', fps.toFixed(1), gpu)
}
await br.close(); process.exit(0)
