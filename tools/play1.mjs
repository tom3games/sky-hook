// 本物のマウスとキーで最初の数手を通す（掛ける → 右へ → こぐ → 離す → 次の輪）
import '../mute-auto.mjs'
import { chromium } from 'playwright'
const PORT = process.env.PORT = String(5500 + Math.floor(Math.random() * 400))
await import('../server.mjs')
const br = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await (await br.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
await page.goto(`http://localhost:${PORT}/?play=1`)
await page.waitForFunction('window.__hookReady', null, { timeout: 30000 })
await page.waitForTimeout(500)
const st = () => page.evaluate(() => { const S = hook.S; return { x: +S.p.x.toFixed(2), y: +S.p.y.toFixed(2), rope: S.rope && S.rope.i, g: hook.grabbable() } })
// 右へ歩いて輪0が届くまで
await page.keyboard.down('KeyD')
for (let i = 0; i < 40; i++) { const s = await st(); if (s.g.includes(0)) break; await page.waitForTimeout(100) }
console.log('reach', await st())
const p0 = await page.evaluate(() => hook.anchorXY(0))
await page.mouse.move(p0.x + 14, p0.y + 10)   // 少しずらして押す
await page.mouse.down()
await page.waitForTimeout(200)
console.log('after press', await st())
await page.screenshot({ path: 'shots/p1_hang.png' })
// こぐ: 振れの向きに合わせて左右
for (let k = 0; k < 60; k++) {
  const vx = await page.evaluate(() => hook.S.p.vx)
  if (vx >= 0) { await page.keyboard.up('KeyA'); await page.keyboard.down('KeyD') } else { await page.keyboard.up('KeyD'); await page.keyboard.down('KeyA') }
  await page.waitForTimeout(50)
}
await page.screenshot({ path: 'shots/p1_swing.png' })
console.log('swing', await st())
await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD')
await page.mouse.up()
await page.waitForTimeout(300)
await page.screenshot({ path: 'shots/p1_fly.png' })
console.log('fly', await st(), 'errors', errs)
await br.close(); process.exit(0)
