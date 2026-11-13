// SKY HOOK 本体: 描画・入力・カメラ・画面の流れ
import * as THREE from 'three'
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from '../vendor/jsm/postprocessing/ShaderPass.js'
import { GTAOPass } from '../vendor/jsm/postprocessing/GTAOPass.js'
import { HDRLoader } from '../vendor/jsm/loaders/HDRLoader.js'
import { makeCourse, TOWER_R } from './course.js?v=1'
import { PH, buildWorld, newState, step, grabbable, anchorPos, swingInfo, respawn } from './physics.js?v=1'
import { View, to3, frame, setAniso, WALL_R } from './view.js?v=1'
import { Climber } from './climber.js?v=1'

window.__jsUp = true
const $ = id => document.getElementById(id)
const Q = new URLSearchParams(location.search)
const isTouch = matchMedia('(pointer: coarse)').matches || Q.get('touch') === '1'
if (isTouch) document.body.classList.add('touch')

// ------------------------------------------------------------ 言葉（日英）
const TXT = {
  ja: {
    loading: '塔へ向かう', kicker: '雲の上まで、振り子で。', logo_sub: '砂の塔を、短いワイヤーで登る', start: '登る', cont: '旗から続ける', how: '遊び方', sound_on: '音 あり', sound_off: '音 なし',
    how_lead: 'ワイヤーは短く、巻き取れない。掛ける輪を自分で選び、左右にこいで振れを大きくし、振れの頂点の手前で離して、上の輪へ跳び移る。',
    k_hook: '掛ける', k_hook_pc: '輪をクリックして押したまま', k_hook_sp: '輪を押したまま', k_rel: '離す', k_rel_pc: 'ボタンを離す', k_rel_sp: '指を離す', k_pump: 'こぐ', k_pump_sp: '左下のボタン', k_look: '見回す', k_look_pc: '何もない所をドラッグ', k_look_sp: '何もない所をなぞる', k_cp: '旗へ戻る', k_cp_sp: '右上の矢印',
    tip1: '届く輪は金色に光る。光っていない輪は、どこかから振れば届く。', tip2: '振れている向きと同じ側を押すと、振れが大きくなる。', tip3: '飛んでいる間に輪を押しておくと、届いた瞬間に掛かる。遠くで掛けるほどワイヤーは長くなる。', tip4: 'ひびの入った台座は掛けると崩れる。錆びた輪は一度離すと折れる。',
    credit: '素材: Quaternius・Poly Haven・Kenney・rubberduck・artisticdude ほか（CC0）',
    falls: '落下', arrived: '頂上', time: '時間', best: '自己ベスト', retry: 'もう一回', share: 'Xでポスト', menu: 'メニュー', paused: '一時停止', resume: '続ける', tocp: '旗へ戻る', back: 'もどる',
    t_grab_pc: '光る輪をクリックして押したまま', t_grab_sp: '光る輪を押したまま', t_walk: 'そのまま右へ。崖から振り出す', t_pump_pc: 'A D でこいで振れを大きく', t_pump_sp: '左下のボタンでこいで振れを大きく', t_rel: '振れの上で離して、次の輪へ', t_next: '飛びながら次の輪を押す',
    saved: '旗', top: '頂上', fellback: '旗へ戻った', sec: { base: '基部', crumble: '崩れ回廊', wind: '風の段', bell: '鐘楼', mill: '風車の層', shaft: '鉄球の縦穴', sand: '砂の滝', crown: '頂の門' },
    best_fmt: b => '自己ベスト ' + b, share_txt: (t, f) => `SKY HOOK 頂上まで ${t}（落下 ${f}回）`,
  },
  en: {
    loading: 'Heading to the tower', kicker: 'Above the clouds, one swing at a time.', logo_sub: 'Climb a sandstone tower on a short wire', start: 'Climb', cont: 'Continue from flag', how: 'How to play', sound_on: 'Sound on', sound_off: 'Sound off',
    how_lead: 'Your wire is short and cannot reel in. Pick a ring, pump left and right to build the swing, let go just before the top of the arc and fly to the next ring.',
    k_hook: 'Hook', k_hook_pc: 'Click a ring and hold', k_hook_sp: 'Hold a ring', k_rel: 'Let go', k_rel_pc: 'Release the button', k_rel_sp: 'Lift your finger', k_pump: 'Pump', k_pump_sp: 'Buttons bottom left', k_look: 'Look around', k_look_pc: 'Drag empty space', k_look_sp: 'Drag empty space', k_cp: 'Back to flag', k_cp_sp: 'Arrow top right',
    tip1: 'Rings in reach glow gold. A dark ring can be reached if you swing from the right place.', tip2: 'Push the same way you are swinging to swing higher.', tip3: 'Hold a ring while flying and you hook the moment it is in reach. Hooking from farther gives a longer wire.', tip4: 'Cracked mounts crumble when hooked. Rusty rings snap after one use.',
    credit: 'Assets: Quaternius, Poly Haven, Kenney, rubberduck, artisticdude and others (CC0)',
    falls: 'Falls', arrived: 'Summit', time: 'Time', best: 'Best', retry: 'Again', share: 'Post on X', menu: 'Menu', paused: 'Paused', resume: 'Resume', tocp: 'Back to flag', back: 'Back',
    t_grab_pc: 'Click and hold a glowing ring', t_grab_sp: 'Hold a glowing ring', t_walk: 'Keep going right. Swing off the edge', t_pump_pc: 'Pump with A / D', t_pump_sp: 'Pump with the buttons bottom left', t_rel: 'Let go near the top of the swing', t_next: 'Hold the next ring while flying',
    saved: 'Flag', top: 'Summit', fellback: 'Back to the flag', sec: { base: 'The Footing', crumble: 'Crumbling Gallery', wind: 'Wind Ledges', bell: 'Belfry', mill: 'Windmill Tier', shaft: 'Wrecking Shaft', sand: 'Sandfall', crown: 'Crown Gate' },
    best_fmt: b => 'Best ' + b, share_txt: (t, f) => `SKY HOOK summit in ${t} (${f} falls)`,
  },
}
let LANG = (() => { try { return localStorage.getItem('hook-lang') } catch (e) { return null } })() || (/^ja/.test(navigator.language) ? 'ja' : 'en')
const t = k => TXT[LANG][k] ?? TXT.ja[k] ?? k
function applyLang() {
  document.documentElement.lang = LANG
  for (const el of document.querySelectorAll('[data-t]')) { const v = t(el.dataset.t); if (typeof v === 'string') el.textContent = v }
  $('langBtn').textContent = LANG === 'ja' ? 'English' : '日本語'
  $('muteBtn').textContent = t(Snd.muted ? 'sound_off' : 'sound_on')
  refreshBest()
}

// ------------------------------------------------------------ 描画の土台
const lowEnd = isTouch && Math.min(screen.width, screen.height) < 500
const QUAL = Q.get('q') || (isTouch ? 'mid' : 'high')
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: Q.has('shot') })
renderer.setPixelRatio(Math.min(devicePixelRatio, lowEnd ? 1.25 : 1.75))
renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
setAniso(Math.min(8, renderer.capabilities.getMaxAnisotropy()))
$('view').appendChild(renderer.domElement)
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 4000)

// 空: 描いた雲海の絵（360度）。継ぎ目は反対側と混ぜて消す
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { map: { value: null }, sunDir: { value: new THREE.Vector3() }, yaw: { value: 0 } },
  vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
  fragmentShader: `uniform sampler2D map; uniform vec3 sunDir; uniform float yaw; varying vec3 vD;
    void main(){ vec3 d = normalize(vD);
      float u = atan(d.x, -d.z) / 6.2831853 + 0.5 + yaw; float v = asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5;
      u = fract(u);
      vec3 a = texture2D(map, vec2(u, v)).rgb, b = texture2D(map, vec2(fract(u + 0.5), v)).rgb;
      float w = smoothstep(0.0, 0.06, min(u, 1.0 - u));
      vec3 c = mix(b, a, w);
      c = pow(c, vec3(2.2));
      float s = max(dot(d, sunDir), 0.0);
      c += vec3(1.0, 0.86, 0.6) * (pow(s, 900.0) * 30.0 + pow(s, 30.0) * 0.35 + pow(s, 6.0) * 0.12);
      gl_FragColor = vec4(c * 1.05, 1.0); }`,
})
const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), skyMat); sky.frustumCulled = false; scene.add(sky)
const SUN = new THREE.Vector3(-0.55, 0.62, 0.55).normalize()
skyMat.uniforms.sunDir.value.copy(SUN)
function placeSun(x, y) {
  const fr = frame(x)
  SUN.set(0, 0, 0).addScaledVector(fr.t, -0.5).addScaledVector(fr.n, 0.62).add(new THREE.Vector3(0, 0.6, 0)).normalize()
  skyMat.uniforms.sunDir.value.copy(SUN)
  const c3 = to3(x, y, 0)
  sun.position.copy(c3).addScaledVector(SUN, 120); sun.target.position.copy(c3)
}
const hemi = new THREE.HemisphereLight(0xa9c4ea, 0x9a7650, 0.75); scene.add(hemi)
const sun = new THREE.DirectionalLight(0xffd7a0, 4.2); scene.add(sun, sun.target)
sun.castShadow = true
sun.shadow.mapSize.set(lowEnd ? 1024 : 2048, lowEnd ? 1024 : 2048)
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 220 })
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.05
scene.fog = new THREE.FogExp2(0xb9c3d6, 0.0016)

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: lowEnd ? 0 : 4 }))
composer.setPixelRatio(renderer.getPixelRatio())
composer.addPass(new RenderPass(scene, camera))
let gtao = null
if (QUAL === 'high') {
  gtao = new GTAOPass(scene, camera, innerWidth, innerHeight)
  gtao.blendIntensity = 0.9
  gtao.updateGtaoMaterial({ radius: 0.8, distanceExponent: 1.5, thickness: 1.5, scale: 1.2, samples: 12 })
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 })
  composer.addPass(gtao)
}
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.35, 0.6, 0.95)
composer.addPass(bloom)
composer.addPass(new OutputPass())
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, res: { value: new THREE.Vector2(innerWidth, innerHeight) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform vec2 res; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, 1.06);
      c.rgb += vec3(0.018, 0.006, -0.02) * smoothstep(0.35, 0.9, l);
      c.rgb += vec3(-0.01, 0.0, 0.02) * (1.0 - smoothstep(0.0, 0.4, l));
      vec2 d = vUv - 0.5; float v = smoothstep(0.95, 0.35, length(d * vec2(1.1, 1.0)));
      c.rgb *= mix(0.72, 1.0, v);
      float g = fract(sin(dot(vUv * res + time, vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (g - 0.5) * 0.016;
      gl_FragColor = c; }`,
})
composer.addPass(grade)
function onResize() { renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); if (gtao) gtao.setSize(innerWidth, innerHeight); grade.uniforms.res.value.set(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); sfx.width = innerWidth; sfx.height = innerHeight }
addEventListener('resize', onResize)

// ------------------------------------------------------------ 世界
const course = makeCourse()
const W = buildWorld(course)
const view = new View(scene, W, { lowEnd })
const climber = new Climber(scene)
let S = newState(W)

// ------------------------------------------------------------ 音
Snd.def({ clank: ['snd/clank1.mp3', 'snd/clank2.mp3'], swish: ['snd/swish-1.mp3', 'snd/swish-2.mp3', 'snd/swish-3.mp3', 'snd/swish.mp3'], crack: ['snd/crack1.mp3', 'snd/crack2.mp3'], rockfall: 'snd/rockfall.mp3', rockbreak: 'snd/rockbreak.mp3', land: ['snd/land1.mp3', 'snd/land2.mp3', 'snd/land3.mp3'], save: 'snd/save.mp3', bell: 'snd/bell.mp3', ballhit: 'snd/ballhit.mp3', chain: ['snd/chain_a.mp3', 'snd/chain_b.mp3'], grunt: ['snd/grunt_01.mp3', 'snd/grunt_02.mp3', 'snd/grunt_03.mp3'], cloth: 'snd/cloth.mp3', finish: 'snd/finish.mp3', creak: ['snd/creak_a.mp3', 'snd/creak_b.mp3'], pebbles: 'snd/pebbles.mp3', splash: 'snd/splash1.mp3', gate: 'snd/gate.mp3' })
try { Snd.muted = localStorage.getItem('hook-mute') === '1' } catch (e) {}
function startAudio() {
  Snd.init(); Snd.setMute(Snd.muted)
  if (Snd.ctx && !Snd.loops.wind) { Snd.loop('wind', 'snd/wind_loop.wav', 0.0001, 0.3); Snd.loop('amb', 'snd/wind.mp3', 0.12, 1.2); Snd.loop('birds', 'snd/birds.mp3', 0.05, 2) }
}

// ------------------------------------------------------------ 入力
const keys = new Set()
const inp = { hook: false, target: -1, pump: 0 }
let hover = -1
let touchPump = 0
const pointers = new Map()      // id -> {kind:'hook'|'pan', x, y}
const pan = { x: 0, y: 0, t: -1e9 }
let mode = 'loading', paused = false

addEventListener('keydown', e => {
  if (e.repeat) return
  keys.add(e.code)
  if (mode !== 'play') return
  if (e.code === 'Escape' || e.code === 'KeyP') setPause(!paused)
  if (e.code === 'KeyR' && !paused) toFlag()
  if (e.code === 'Space') { e.preventDefault(); if (hover >= 0) { inp.hook = true; inp.target = hover; pointers.set('key', { kind: 'hook' }) } }
})
addEventListener('keyup', e => {
  keys.delete(e.code)
  if (e.code === 'Space' && pointers.get('key')) { pointers.delete('key'); releaseHookIfNone() }
})
// 画面の点 → 一番近い掛け点（指のずれに優しく: 輪の周り 56px か 1.3m の広い方）
const _v = new THREE.Vector3(), _q = { x: 0, y: 0 }
export function pickAt(cx, cy) {
  const rc = renderer.domElement.getBoundingClientRect()
  let best = -1, bd = 1e9
  const gset = new Set(grabbable(W, S))
  for (const a of W.anchors) {
    if (Math.abs(a.y - S.p.y) > 40) continue
    const st = S.an[a.i]
    if ((a.kind === 'rusty' && st.used) || st.back > 0 || st.fallT > 0) continue
    anchorPos(W, S, a, _q)
    to3(_q.x, _q.y, 0, _v)
    const d3 = _v.distanceTo(camera.position)
    _v.project(camera)
    if (_v.z > 1) continue
    const sx = rc.left + (_v.x + 1) / 2 * rc.width, sy = rc.top + (1 - _v.y) / 2 * rc.height
    const pxPerM = rc.height / (2 * Math.tan(camera.fov * Math.PI / 360) * d3)
    const tol = Math.max(isTouch ? 56 : 40, 1.3 * pxPerM)
    let d = Math.hypot(sx - cx, sy - cy)
    if (d > tol) continue
    if (gset.has(a.i)) d -= 16     // 届く点を少し優先
    if (d < bd) { bd = d; best = a.i }
  }
  return best
}
function releaseHookIfNone() {
  for (const p of pointers.values()) if (p.kind === 'hook') return
  inp.hook = false; inp.target = -1
}
const cv = renderer.domElement
cv.addEventListener('pointerdown', e => {
  startAudio()
  if (mode !== 'play' || paused) return
  e.preventDefault()
  try { cv.setPointerCapture(e.pointerId) } catch (er) {}
  const i = e.button === 2 ? -1 : pickAt(e.clientX, e.clientY)
  if (i >= 0) { pointers.set(e.pointerId, { kind: 'hook', x: e.clientX, y: e.clientY }); inp.hook = true; inp.target = i; tutHooked = true }
  else pointers.set(e.pointerId, { kind: 'pan', x: e.clientX, y: e.clientY })
})
addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId)
  if (!p) { if (!isTouch && mode === 'play') hover = pickAt(e.clientX, e.clientY); return }
  if (p.kind === 'pan') {
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY
    const m = camDist() * 2 * Math.tan(camera.fov * Math.PI / 360) / innerHeight
    pan.x = Math.max(-22, Math.min(22, pan.x - dx * m * 1.1)); pan.y = Math.max(-22, Math.min(30, pan.y + dy * m * 1.1)); pan.t = performance.now()
  }
})
const endPtr = e => { if (!pointers.has(e.pointerId)) return; pointers.delete(e.pointerId); releaseHookIfNone() }
addEventListener('pointerup', endPtr); addEventListener('pointercancel', endPtr)
for (const b of document.querySelectorAll('.pump')) {
  const k = +b.dataset.k
  b.addEventListener('pointerdown', e => { e.preventDefault(); startAudio(); touchPump = k; b.classList.add('on'); try { b.setPointerCapture(e.pointerId) } catch (er) {} })
  const up = () => { if (touchPump === k) touchPump = 0; b.classList.remove('on') }
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up)
}
function gatherPump() {
  let u = touchPump
  if (keys.has('KeyA') || keys.has('ArrowLeft')) u -= 1
  if (keys.has('KeyD') || keys.has('ArrowRight')) u += 1
  return Math.max(-1, Math.min(1, u))
}

// ------------------------------------------------------------ カメラ
// 塔の外、少し横・少し下から、壁にそって見上げる（絵 C の構図）。縦長の画面では引いて、左右 9m は必ず映す
const cam = { x: 0, y: 0, d: 20, look: new THREE.Vector3(), pos: new THREE.Vector3(), fovK: 0, tilt: 0 }
function camDist() {
  if (DBG.camD) return DBG.camD
  const vh = Math.tan(camera.fov * Math.PI / 360)
  const needW = 8, needH = 8.5
  return Math.max(needH / vh, needW / (vh * camera.aspect)) * 0.95
}
function updateCamera(dt, snap) {
  const p = S.p
  const idle = performance.now() - pan.t > 2200 && ![...pointers.values()].some(q => q.kind === 'pan')
  if (idle) { const k = Math.exp(-dt * 1.2); pan.x *= k; pan.y *= k }
  const tx = p.x + p.vx * 0.22 + pan.x, ty = p.y + 2.2 + Math.max(-2, p.vy * 0.1) + pan.y + (DBG.lookDY || 0)
  const k = snap ? 1 : 1 - Math.exp(-dt * 4.5)
  cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k
  const D = camDist()
  cam.d += (D - cam.d) * (snap ? 1 : 1 - Math.exp(-dt * 2))
  // 横へずらして斜めから（壁の奥行きが見える）。ずらす向きは周りの見通しのよい側（右）に固定
  const side = cam.d * 0.32
  to3(cam.x + side, cam.y - cam.d * 0.06, cam.d * 0.92, cam.pos)
  to3(cam.x, cam.y, 0, cam.look)
  camera.position.copy(cam.pos)
  camera.up.set(0, 1, 0)
  camera.lookAt(cam.look)
  // 振り子の向きに少しだけ傾ける・速いほど視野を広く
  const sp = Math.hypot(p.vx, p.vy)
  const tilt = S.rope ? Math.max(-0.06, Math.min(0.06, -p.vx * 0.006)) : 0
  cam.tilt += (tilt - cam.tilt) * (1 - Math.exp(-dt * 3))
  camera.rotateZ(cam.tilt)
  const fovT = 55 + Math.min(12, Math.max(0, sp - 8) * 0.9) + cam.fovK
  cam.fovK *= Math.exp(-dt * 5)
  if (Math.abs(camera.fov - fovT) > 0.05) { camera.fov += (fovT - camera.fov) * (1 - Math.exp(-dt * 4)); camera.updateProjectionMatrix() }
  // 影の範囲は人について行く。太陽は見ている面を左前の上から照らす向きに保つ（丸い塔の裏側を真っ暗にしない）
  placeSun(p.x, p.y)
}

// ------------------------------------------------------------ 速さの線（画面のふちから流れる）
const sfx = $('speedfx'); sfx.width = innerWidth; sfx.height = innerHeight
const sctx = sfx.getContext('2d')
const lines = Array.from({ length: 46 }, (_, i) => ({ a: i * 2.399, r: 0.5 + (i * 0.618 % 1) * 0.5, l: 0 }))
function drawSpeed(sp, dt) {
  sctx.clearRect(0, 0, sfx.width, sfx.height)
  const k = Math.max(0, Math.min(1, (sp - 14) / 14))
  if (k <= 0) return
  const cx = sfx.width / 2, cy = sfx.height / 2, R0 = Math.hypot(cx, cy)
  sctx.strokeStyle = `rgba(255,248,232,${0.28 * k})`; sctx.lineWidth = 1.5
  const n = Math.floor(lines.length * k)
  for (let i = 0; i < n; i++) {
    const L = lines[i]; L.r -= dt * (0.9 + k * 1.4); if (L.r < 0.55) L.r = 1.05
    const r1 = R0 * L.r, r2 = r1 - R0 * (0.08 + 0.12 * k)
    sctx.beginPath(); sctx.moveTo(cx + Math.cos(L.a) * r1, cy + Math.sin(L.a) * r1); sctx.lineTo(cx + Math.cos(L.a) * r2, cy + Math.sin(L.a) * r2); sctx.stroke()
  }
}

// ------------------------------------------------------------ 画面
let toastT = 0
function toast(s, sec = 1.6) { const el = $('toast'); el.textContent = s; el.classList.add('on'); toastT = sec }
function flash() { const f = $('flash'); f.style.transition = 'none'; f.style.opacity = '0.7'; requestAnimationFrame(() => { f.style.transition = 'opacity .35s'; f.style.opacity = '0' }) }
let shake = 0, hitStop = 0
const fmt = s => { const m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + String(r).padStart(2, '0') }
function getBest() { try { return +localStorage.getItem('hook-best') || 0 } catch (e) { return 0 } }
function refreshBest() { const b = getBest(); $('bestTxt').textContent = b ? t('best_fmt')(fmt(b)) : '' }
function saveProgress() { try { localStorage.setItem('hook-cp', JSON.stringify({ cp: S.cp, t: S.t, falls: S.falls })) } catch (e) {} }
function loadProgress() { try { return JSON.parse(localStorage.getItem('hook-cp') || 'null') } catch (e) { return null } }
function show(id) { for (const s of ['loading', 'title', 'how', 'result', 'pause']) $(s).hidden = s !== id }
// 高度計（旗の位置に印）
const yMin = 0, yMax = Math.max(...course.anchors.map(a => a.y)) + 4
function altY(y) { return Math.max(0, Math.min(1, (y - yMin) / (yMax - yMin))) }
for (const f of course.flags) { const d = document.createElement('div'); d.className = 'fl'; d.style.bottom = (altY(f.y) * 100) + '%'; $('altTrack').appendChild(d) }

// チュートリアル（最初の1回だけ・同時に1つ）
let tutHooked = false, tutStage = 0
function tutorial() {
  const el = $('tut')
  if (S.cp >= 0 || tutStage >= 5) { el.classList.remove('on'); return }
  let msg = ''
  if (tutStage === 0) { msg = t(isTouch ? 't_grab_sp' : 't_grab_pc'); if (S.rope) tutStage = 1 }
  else if (tutStage === 1) { msg = S.p.ground ? t('t_walk') : t(isTouch ? 't_pump_sp' : 't_pump_pc'); const si = swingInfo(W, S); if (si && si.thMax > 1.2) tutStage = 2; if (!S.rope) tutStage = 0 }
  else if (tutStage === 2) { msg = t('t_rel'); if (!S.rope) tutStage = 3 }
  else if (tutStage === 3) { msg = t('t_next'); if (S.rope && S.rope.i !== 0) tutStage = 5 }
  el.textContent = msg; el.classList.toggle('on', !!msg)
}

function setPause(v) { paused = v; $('pause').hidden = !v; if (v) { pointers.clear(); inp.hook = false; inp.target = -1 } }
function toFlag() { respawn(W, S, false); onRespawn(); setPause(false) }
function onRespawn() { pointers.clear(); inp.hook = false; inp.target = -1; flash() }
function startGame(fromCp) {
  S = newState(W)
  const pr = fromCp ? loadProgress() : null
  if (pr && pr.cp >= 0 && W.flags[pr.cp]) { const f = W.flags[pr.cp]; S.cp = pr.cp; S.cpX = f.x; S.cpY = f.y + 0.6; S.p.x = S.cpX; S.p.y = S.cpY; S.t = pr.t || 0; S.falls = pr.falls || 0; tutStage = 5 }
  else tutStage = 0
  mode = 'play'; paused = false
  show(null); $('hud').hidden = false; $('touch').hidden = !isTouch
  pan.x = pan.y = 0
  updateCamera(0, true)
  startAudio()
}
function finish() {
  mode = 'result'
  const tm = S.doneT, b = getBest()
  if (!b || tm < b) try { localStorage.setItem('hook-best', String(tm)) } catch (e) {}
  try { localStorage.removeItem('hook-cp') } catch (e) {}
  $('rTime').textContent = fmt(tm); $('rFalls').textContent = S.falls; $('rBest').textContent = fmt(Math.min(tm, b || tm))
  const url = 'https://tom3games.github.io/sky-hook/'
  $('rShare').href = 'https://x.com/intent/post?text=' + encodeURIComponent(t('share_txt')(fmt(tm), S.falls) + ' #SKYHOOK') + '&url=' + encodeURIComponent(url)
  $('hud').hidden = true; $('touch').hidden = true
  Snd.play('finish')
  setTimeout(() => show('result'), 1600)
}
$('startBtn').onclick = () => { startAudio(); startGame(false) }
$('contBtn').onclick = () => { startAudio(); startGame(true) }
$('howBtn').onclick = () => show('how')
$('pHow').onclick = () => { $('pause').hidden = true; show('how') }
$('howClose').onclick = () => { if (mode === 'play') { show(null); $('pause').hidden = !paused } else show('title') }
$('langBtn').onclick = () => { LANG = LANG === 'ja' ? 'en' : 'ja'; try { localStorage.setItem('hook-lang', LANG) } catch (e) {} applyLang() }
$('muteBtn').onclick = () => { Snd.muted = !Snd.muted; Snd.setMute(Snd.muted); try { localStorage.setItem('hook-mute', Snd.muted ? '1' : '0') } catch (e) {} applyLang() }
$('bMenu').onclick = () => setPause(true)
$('bCp').onclick = () => { if (mode === 'play') toFlag() }
$('pResume').onclick = () => setPause(false)
$('pCp').onclick = () => toFlag()
$('pMenu').onclick = () => { setPause(false); toTitle() }
$('rRetry').onclick = () => startGame(false)
$('rMenu').onclick = () => toTitle()
function toTitle() { mode = 'title'; show('title'); $('hud').hidden = true; $('touch').hidden = true; const pr = loadProgress(); $('contBtn').hidden = !(pr && pr.cp >= 0); S = newState(W); refreshBest() }

// ------------------------------------------------------------ 出来事 → 音と演出
let lastSec = ''
function events() {
  for (const e of S.ev) {
    if (e.t === 'grab') { Snd.play('clank', { vol: 0.55 }); if (Math.hypot(S.p.vx, S.p.vy) > 9) { hitStop = 0.04; shake = 0.15 } }
    else if (e.t === 'release') { const v = e.v; if (v > 10) { Snd.play('swish', { vol: Math.min(0.8, v / 24) }); cam.fovK = 4 } }
    else if (e.t === 'crumble') { Snd.play('crack'); Snd.play('rockfall', { vol: 0.5 }); shake = 0.25 }
    else if (e.t === 'rustbreak') { Snd.play('crack', { vol: 0.6 }) }
    else if (e.t === 'bell') Snd.play('bell', { vol: 0.8 })
    else if (e.t === 'hit') { Snd.play('ballhit'); Snd.play('grunt', { vol: 0.6 }); hitStop = 0.1; shake = 0.45; flash() }
    else if (e.t === 'flag') { Snd.play('save', { vol: 0.7 }); Snd.play('cloth', { vol: 0.5 }); toast(t('saved') + ' ' + (e.i + 1)); saveProgress() }
    else if (e.t === 'fall' || e.t === 'drown') { onRespawn(); toast(t('fellback')) }
    else if (e.t === 'thud') { Snd.play('land', { vol: Math.min(0.8, e.v / 20) }); shake = Math.min(0.3, e.v / 60) }
    else if (e.t === 'top') finish()
  }
  S.ev.length = 0
  // 区間の名前
  const sec = course.sections.find(s => S.p.y >= s.y0 && S.p.y < s.y1)
  if (sec && sec.key !== lastSec) { if (lastSec) toast(t('sec')[sec.key] || '', 2.2); lastSec = sec.key }
}

// ------------------------------------------------------------ ループ（物理は固定 60Hz）
let acc = 0, last = performance.now(), fpsN = 0, fpsT = 0
window.__fps = 0
function frameLoop(now) {
  requestAnimationFrame(frameLoop)
  let dt = Math.min(0.1, (now - last) / 1000); last = now
  fpsN++; fpsT += dt; if (fpsT > 1) { window.__fps = fpsN / fpsT; fpsN = 0; fpsT = 0 }
  if (DBG.frozen) dt = 0
  if (mode === 'play' && !paused) {
    if (hitStop > 0) { hitStop -= dt; dt *= 0.15 }
    acc += dt
    while (acc >= PH.dt) {
      acc -= PH.dt
      inp.pump = DBG.bot ? DBG.bot.pump : gatherPump()
      if (DBG.bot) { inp.hook = DBG.bot.hook; inp.target = DBG.bot.target }
      step(W, S, inp)
      events()
      if (DBG.onStep) DBG.onStep(S)
      if (mode !== 'play') break
    }
    tutorial()
  } else if (mode === 'title') {
    // タイトル: ゆっくり塔の周りを回る
    S.t += dt
  }
  const grabs = mode === 'play' ? grabbable(W, S) : []
  const anc = S.rope ? anchorPos(W, S, W.anchors[S.rope.i], { x: 0, y: 0 }) : null
  const aimA = inp.target >= 0 && !S.rope ? anchorPos(W, S, W.anchors[inp.target], { x: 0, y: 0 }) : null
  climber.update(S, anc, aimA, dt, camera.position)
  view.update(S, { grabbable: grabs, hover: isTouch ? -1 : hover, target: inp.target, hand: climber.hand }, dt, camera)
  if (mode === 'title') {
    const a = S.t * 0.05
    cam.x = -8 + Math.sin(a) * 10; cam.y = 14 + Math.sin(a * 0.7) * 6
    cam.d = 34
    to3(cam.x + 14, cam.y - 8, 30, camera.position); camera.lookAt(to3(cam.x - 4, cam.y + 6, 0))
    if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix() }
    placeSun(cam.x, cam.y)
  } else updateCamera(dt, false)
  if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 0.5; camera.position.y += (Math.random() - 0.5) * shake * 0.5; shake = Math.max(0, shake - dt * 1.6) }
  // 空の絵は塔のどこから見ても同じ向き
  sky.position.copy(camera.position)
  const sp = Math.hypot(S.p.vx, S.p.vy)
  drawSpeed(mode === 'play' ? sp : 0, dt)
  if (Snd.ctx && Snd.loops.wind && Snd.loops.wind.gain) { const g = Snd.loops.wind.gain.gain; g.value += (Math.min(0.55, Math.max(0, sp - 6) / 24) - g.value) * 0.08 }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('on') }
  if (mode === 'play') {
    $('tm').textContent = fmt(S.t); $('fl').textContent = S.falls
    $('altMe').style.bottom = (altY(S.p.y) * 100) + '%'; $('altNum').textContent = Math.max(0, Math.round(S.p.y)) + 'm'
  }
  grade.uniforms.time.value = now * 0.001
  composer.render()
}

// ------------------------------------------------------------ 検査用の窓口
const DBG = { frozen: false, bot: null, onStep: null }
window.hook = {
  W, get S() { return S }, set S(v) { S = v }, PH, DBG, camera, pickAt, climber,
  anchorXY(i) { anchorPos(W, S, W.anchors[i], _q); to3(_q.x, _q.y, 0, _v); _v.project(camera); const rc = renderer.domElement.getBoundingClientRect(); return { x: rc.left + (_v.x + 1) / 2 * rc.width, y: rc.top + (1 - _v.y) / 2 * rc.height } },
  start: (cp) => startGame(cp), get mode() { return mode }, grabbable: () => grabbable(W, S),
  place(x, y) { S.p.x = x; S.p.y = y; S.p.vx = S.p.vy = 0; S.rope = null; updateCamera(0, true) },
  warpFlag(i) { const f = W.flags[i]; S.cp = i; S.cpX = f.x; S.cpY = f.y + 0.6; respawn(W, S, false); updateCamera(0, true) },
  frame(n = 1) { for (let k = 0; k < n; k++) { step(W, S, inp); events() } updateCamera(0, true) },
}

// ------------------------------------------------------------ 読み込み
async function boot() {
  const fill = $('ldFill')
  let done = 0, total = 3
  const tick = () => { done++; fill.style.width = (done / total * 100) + '%' }
  const texP = new Promise(res => { const tl = new THREE.TextureLoader(); tl.load('assets/pano.webp', tx => { tx.colorSpace = THREE.NoColorSpace; tx.minFilter = THREE.LinearFilter; tx.generateMipmaps = false; skyMat.uniforms.map.value = tx; tick(); res() }, undefined, () => { tick(); res() }) })
  const hdrP = new HDRLoader().loadAsync('assets/sky_1k.hdr').then(hdr => { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromEquirectangular(hdr).texture; scene.environmentIntensity = 0.55; pm.dispose(); hdr.dispose(); tick() }).catch(() => tick())
  const chP = climber.load('assets/models/Rider.glb').then(tick).catch(e => { console.warn(e); tick() })
  await Promise.race([Promise.all([texP, hdrP, chP]), new Promise(r => setTimeout(r, 11000))])
  applyLang()
  const pr = loadProgress(); $('contBtn').hidden = !(pr && pr.cp >= 0)
  if (Q.has('play')) startGame(Q.get('play') === 'cp')
  else { mode = 'title'; show('title') }
  window.__hookReady = true
}
applyLang()
requestAnimationFrame(frameLoop)
boot()
