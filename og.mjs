import './mute-auto.mjs'
// SNS 用の画像 og.png（1200x630）: 遊んでいる一番の場面（風車の層で大きく振っている所）＋題名
import { chromium } from 'playwright'
process.env.PORT = String(5500 + Math.floor(Math.random() * 400))
await import('./server.mjs')
const br = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const p = await (await br.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage()
await p.goto(`http://localhost:${process.env.PORT}/?play=1&q=high&nolock=1`)
await p.waitForFunction('window.__hookReady', null, { timeout: 40000 })
// 風車の層の旗から、回る輪のそばで大きく振らせる
await p.evaluate(() => {
  hook.warpFlag(3)
  const W = hook.W, f = W.flags[3]
  const target = W.anchors.findIndex(a => a.move && a.move.k === 'circle')
  hook.DBG.bot = { hook: false, target: -1, pump: 0 }
  const a = W.anchors[target - 2]
  hook.place(a.x - 3, a.y - 5)
  hook.DBG.bot = { hook: true, target: target - 2, mx: 1, mz: 0 }
  let n = 0
  hook.DBG.onStep = S => { n++; hook.DBG.bot.mx = S.p.vx >= 0 ? 1 : -1 }
})
await p.waitForTimeout(5200)
await p.evaluate(() => { hook.DBG.frozen = true; document.getElementById('hud').hidden = true; document.getElementById('touch').hidden = true
  const d = document.createElement('div')
  d.innerHTML = '<div style="position:fixed;left:44px;bottom:40px;color:#fff6e6;font-family:Cinzel,serif;font-weight:900;font-size:96px;letter-spacing:.04em;text-shadow:0 3px 0 #7e5c41,0 8px 30px rgba(30,20,10,.5);line-height:1">SKY HOOK<div style="font-family:\'Shippori Mincho B1\',serif;font-size:26px;font-weight:800;letter-spacing:.14em;margin-top:12px;text-shadow:0 1px 8px rgba(0,0,0,.5)">短いワイヤーで、雲の上の塔を登る</div></div>'
  document.body.appendChild(d) })
await p.waitForTimeout(600)
await p.screenshot({ path: 'og.png' })
await br.close(); process.exit(0)
