import '../mute-auto.mjs'
// 公開版の確認: Chromium と WebKit で開いて、始めて、輪に掛けて離す。エラー0・og.png 200
import { chromium, webkit } from 'playwright'
const URL = process.env.URL || 'https://tom3games.github.io/sky-hook/'
let bad = 0
for (const [n, e] of [['chromium', chromium], ['webkit', webkit]]) {
  const b = await e.launch(n === 'chromium' ? { args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : {})
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' })).newPage()
  const errs = []; p.on('pageerror', x => errs.push(x.message)); p.on('requestfailed', r => { if (!/fonts/.test(r.url())) errs.push('reqfail ' + r.url()) })
  const t0 = Date.now()
  await p.goto(URL + '?t=' + Date.now()); await p.waitForFunction('window.__hookReady', null, { timeout: 40000 })
  const ready = Date.now() - t0
  await p.click('#startBtn'); await p.waitForTimeout(500)
  await p.evaluate(() => hook.place(-0.5, 0.4)); await p.waitForTimeout(400)
  const a = await p.evaluate(() => hook.anchorXY(0))
  await p.mouse.move(a.x + 10, a.y + 10); await p.mouse.down()
  await p.waitForFunction(() => !!hook.S.rope, null, { timeout: 4000 }).catch(() => {})
  const hooked = await p.evaluate(() => !!hook.S.rope)
  await p.mouse.up()
  const og = await p.evaluate(async () => (await fetch('og.png')).status)
  const v = await p.evaluate(() => document.querySelector('script[src*="game.js"]').getAttribute('src'))
  console.log(n, { ready, hooked, og, v, errs })
  if (!hooked || og !== 200 || errs.length) bad++
  await b.close()
}
process.exit(bad ? 1 : 0)
