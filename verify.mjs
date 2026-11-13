import './mute-auto.mjs'
// SKY HOOK の検査。node verify.mjs  （Chromium と WebKit、スマホ縦横・PC、本物の指とマウスで掛ける）
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
import { chromium, webkit } from 'playwright'
import { mkdirSync } from 'node:fs'
const ROOT = import.meta.dirname
mkdirSync(ROOT + '/shots/v', { recursive: true })
process.env.PORT = String(5800 + Math.floor(Math.random() * 300))
await import('./server.mjs')
const URL0 = `http://localhost:${process.env.PORT}/`
let pass = 0, fail = 0
const results = []
async function t(name, fn) {
  try { const r = await fn(); if (r === false) throw new Error('false'); pass++; results.push(`ok   ${name}${r && r !== true ? '  ' + JSON.stringify(r) : ''}`) }
  catch (e) { fail++; results.push(`FAIL ${name}  ${e.message.split('\n')[0]}`) }
}
const expect = (c, msg) => { if (!c) throw new Error(msg) }
const GL = ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
async function open(browser, opts = {}, q = '') {
  const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, ...opts })
  await muteContext(ctx)
  await ctx.addInitScript(() => { try { localStorage.clear() } catch (e) {} })
  const p = await ctx.newPage(); p.errs = []
  p.on('pageerror', e => p.errs.push('pageerror ' + e.message))
  p.on('console', m => { if (m.type() === 'error') p.errs.push('console ' + m.text()) })
  p.on('requestfailed', r => { if (!/fonts\.(googleapis|gstatic)/.test(r.url()) && !/ABORTED|cancelled/i.test(r.failure()?.errorText || '')) p.errs.push('reqfail ' + r.url()) })
  await p.goto(URL0 + q); await p.waitForFunction(() => window.__hookReady, null, { timeout: 30000 })
  return p
}
const noScroll = p => p.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, w: innerWidth, h: innerHeight }))
// 画面が描けているか（輝度のばらつき）
const lumaStd = p => p.evaluate(() => {
  const c = document.querySelector('#view canvas'), g = c.getContext('webgl2') || c.getContext('webgl')
  const w = 64, h = 64, px = new Uint8Array(w * h * 4)
  g.readPixels(Math.floor(c.width / 2 - 32), Math.floor(c.height / 2 - 32), w, h, g.RGBA, g.UNSIGNED_BYTE, px)
  let s = 0, s2 = 0; for (let i = 0; i < w * h; i++) { const l = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11; s += l; s2 += l * l }
  const m = s / (w * h); return Math.sqrt(s2 / (w * h) - m * m)
})

for (const [ename, eng] of [['chromium', chromium], ['webkit', webkit]]) {
  const br = await eng.launch(ename === 'chromium' ? { ...MUTE_LAUNCH, args: [...MUTE_LAUNCH.args, ...GL] } : {})
  // ---- スマホ縦: タイトル → 始める → 輪を指で押して掛ける（ずらして押す）→ 離す
  await t(`${ename} スマホ縦 タイトルから掛けて離すまで`, async () => {
    const p = await open(br, { hasTouch: true, isMobile: true }, '?shot=1')
    await p.screenshot({ path: `shots/v/${ename}_title.png` })
    const b = await p.locator('#startBtn').boundingBox(); expect(b && b.y + b.height <= 844, 'start btn off screen')
    await p.tap('#startBtn'); await p.waitForTimeout(600)
    expect(await p.evaluate(() => hook.mode) === 'play', 'not playing')
    expect(await p.evaluate(() => window.__muteOk ? window.__muteOk() : true), 'sound not muted')
    // 輪0 が届くまで右へ（こぐボタンを押したまま）
    const pb = await p.locator('.pump[data-k="1"]').boundingBox()
    expect(pb && pb.width >= 64, 'pump button small')
    await p.evaluate(() => { hook.place(-0.5, 0.4) }); await p.waitForTimeout(300)
    expect((await p.evaluate(() => hook.grabbable())).includes(0), 'ring 0 not in reach')
    await p.evaluate(() => hook.aimAt(0)); await p.waitForTimeout(200)
    const a = await p.evaluate(() => hook.anchorXY(0))
    await p.touchscreen.tap(a.x + 30, a.y + 22)   // 36px ずらして押す
    // tap は押してすぐ離すので、押しっぱなしは CDP で
    const cdp = await p.context().newCDPSession(p).catch(() => null)
    let held = false
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x + 30, y: a.y + 22 }] })
      await p.waitForTimeout(250)
      held = await p.evaluate(() => !!hook.S.rope)
      await p.screenshot({ path: `shots/v/${ename}_hold.png` })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await p.waitForTimeout(150)
      expect(!(await p.evaluate(() => !!hook.S.rope)), 'rope not released')
    } else {
      // WebKit（CDP なし）: 画面の同じ点に指の pointerdown を送り、押したまま数コマ待ってから離す
      await p.waitForTimeout(400)
      held = await p.evaluate(async ([x, y]) => {
        const cv = document.querySelector('#view canvas')
        cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 7, pointerType: 'touch', bubbles: true, isPrimary: true }))
        await new Promise(r => setTimeout(r, 250))
        const h = !!hook.S.rope
        window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 7, pointerType: 'touch', bubbles: true }))
        await new Promise(r => setTimeout(r, 120))
        return h && !hook.S.rope
      }, [a.x + 30, a.y + 22])
    }
    expect(held, 'did not hook with offset tap')
    const ls = await lumaStd(p); expect(ls > 8, 'blank render ' + ls)
    const ns = await noScroll(p); expect(ns.sw <= ns.w && ns.sh <= ns.h, 'scroll ' + JSON.stringify(ns))
    expect(!p.errs.length, p.errs.join(' | '))
    await p.context().close()
    return { luma: Math.round(ls) }
  })
  // ---- 画面サイズごと: 一画面に収まる・ボタンが画面内
  for (const [w, h, touch] of [[360, 640, 1], [390, 844, 1], [430, 932, 1], [844, 390, 1], [1280, 720, 0]]) {
    await t(`${ename} ${w}x${h} 一画面・部品が画面内`, async () => {
      const p = await open(br, { viewport: { width: w, height: h }, hasTouch: !!touch, isMobile: !!touch && ename === 'chromium' })
      const ns = await noScroll(p); expect(ns.sw <= w && ns.sh <= h, 'scroll')
      await p.screenshot({ path: `shots/v/${ename}_${w}x${h}_title.png` })
      await p.click('#howBtn'); await p.waitForTimeout(200)
      const pr = await p.locator('#how .panel').boundingBox(); expect(pr.y >= 0 && pr.y + pr.height <= h + 1, 'how panel overflow')
      await p.screenshot({ path: `shots/v/${ename}_${w}x${h}_how.png` })
      await p.click('#howClose'); await p.click('#startBtn'); await p.waitForTimeout(700)
      for (const sel of touch ? ['.pump[data-k="-1"]', '.pump[data-k="1"]', '#bCp', '#bMenu'] : ['#bCp', '#bMenu']) {
        const b = await p.locator(sel).boundingBox(); expect(b && b.x >= 0 && b.y >= 0 && b.x + b.width <= w && b.y + b.height <= h, sel + ' off screen')
      }
      // 遊び中に見えている輪が画面内にあるか（掛ける点が押せる）
      const inView = await p.evaluate(() => hook.grabbable().length ? hook.grabbable().map(i => hook.anchorXY(i)).filter(q => q.x > 0 && q.y > 0 && q.x < innerWidth && q.y < innerHeight).length : -1)
      await p.evaluate(() => hook.warpFlag(2)); await p.waitForTimeout(800)
      const inView2 = await p.evaluate(() => hook.grabbable().map(i => hook.anchorXY(i)).filter(q => q.x > 0 && q.y > 0 && q.x < innerWidth && q.y < innerHeight).length)
      await p.screenshot({ path: `shots/v/${ename}_${w}x${h}_play.png` })
      expect(inView2 >= 1, 'no grabbable ring on screen at flag 3')
      expect(!p.errs.length, p.errs.join(' | '))
      await p.context().close()
      return { ringsOnScreen: inView2 }
    })
  }
  // ---- PC: マウスで押したまま掛ける・離す、英語
  await t(`${ename} PC マウスで掛ける・英語・一時停止`, async () => {
    const p = await open(br, { viewport: { width: 1280, height: 720 } }, '?nolock=1')
    await p.click('#langBtn'); expect((await p.textContent('#startBtn b')) === 'Climb', 'english')
    await p.click('#startBtn'); await p.waitForTimeout(500)
    await p.evaluate(() => hook.place(-0.5, 0.4)); await p.waitForTimeout(300)
    // 照準（画面の中央）を輪 0 に合わせ、照準が輪 0 を選んでいるかを見てからクリック
    const hv = await p.evaluate(() => hook.aimAt(0))
    expect(hv === 0, 'reticle not on ring 0: ' + hv)
    await p.mouse.move(640, 360); await p.mouse.down()
    await p.waitForFunction(() => !!hook.S.rope, null, { timeout: 3000 }).catch(() => {})
    expect(await p.evaluate(() => !!hook.S.rope), 'no hook with mouse')
    await p.keyboard.down('KeyD'); await p.waitForTimeout(800); await p.keyboard.up('KeyD')
    await p.mouse.up()
    await p.waitForFunction(() => !hook.S.rope, null, { timeout: 3000 }).catch(() => {})
    expect(!(await p.evaluate(() => !!hook.S.rope)), 'not released')
    // 何もない所を押しても掛からない（見回すだけ）
    await p.mouse.move(40, 360); await p.mouse.down(); await p.mouse.move(40, 200, { steps: 5 }); await p.mouse.up()
    expect(!(await p.evaluate(() => !!hook.S.rope)), 'hooked on empty')
    await p.keyboard.press('Escape'); await p.waitForTimeout(100)
    expect(await p.isVisible('#pause'), 'pause')
    await p.click('#pResume')
    expect(!p.errs.length, p.errs.join(' | '))
    await p.context().close()
  })
  // ---- 照準と実際に掛かる輪がずれない: 各旗で、届く輪に照準を向けると、その輪が選ばれ、押すとその輪に掛かる
  await t(`${ename} 照準と掛かる輪が一致（旗ごと・届く輪全部）`, async () => {
    const p = await open(br, { viewport: { width: 1280, height: 720 } }, '?play=1&nolock=1')
    let n = 0, bad = []
    for (let f = 0; f < 7; f++) {
      const r = await p.evaluate(fl => { hook.warpFlag(fl); const out = []; for (const i of hook.grabbable()) { const h = hook.aimAt(i); out.push([i, h]) } return out }, f)
      for (const [i, h] of r) { n++; if (i !== h) bad.push(f + ':' + i + '->' + h) }
    }
    // 押すと狙った輪に掛かる（物理の 1 コマで確かめる）
    const hookOk = await p.evaluate(() => { hook.warpFlag(2); const i = hook.grabbable()[0]; hook.aimAt(i); const ok0 = hook.hover; hook.frame(2, { hook: true, target: ok0, pump: 0 }); return hook.S.rope && hook.S.rope.i === i })
    expect(!bad.length, bad.join(' '))
    expect(hookOk, 'hook target mismatch')
    await p.context().close()
    return { rings: n }
  })
  // ---- 落ちたら旗の足場に戻る
  await t(`${ename} 落ちたら旗へ戻る`, async () => {
    const p = await open(br, { viewport: { width: 1280, height: 720 } }, '?play=1')
    await p.evaluate(() => { hook.warpFlag(1); hook.place(hook.W.flags[1].x + 6, hook.W.flags[1].y - 2) })
    await p.waitForTimeout(3500)
    const s = await p.evaluate(() => ({ x: hook.S.p.x, y: hook.S.p.y, falls: hook.S.falls, f: hook.W.flags[1] }))
    expect(s.falls >= 1 && Math.abs(s.x - s.f.x) < 2 && Math.abs(s.y - s.f.y - 0.4) < 1.5, JSON.stringify(s))
    await p.context().close()
    return { falls: s.falls }
  })
  await br.close()
}
console.log(results.join('\n'))
console.log(`\n${pass} ok / ${fail} fail`)
process.exit(fail ? 1 : 0)
