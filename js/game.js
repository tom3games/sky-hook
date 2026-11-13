// SKY HOOK 本体: 描画・入力・カメラ・画面の流れ
import * as THREE from 'three'
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from '../vendor/jsm/postprocessing/ShaderPass.js'
import { GTAOPass } from '../vendor/jsm/postprocessing/GTAOPass.js'
import { makeCourse, TOWER_R } from './course.js?v=4'
import { PH, buildWorld, newState, step, grabbable, anchorPos, swingInfo, respawn } from './physics.js?v=4'
import { View, to3, frame, setAniso, WALL_R } from './view.js?v=4'
import { Climber } from './climber.js?v=4'

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
    k_hook: '掛ける', k_hook_pc: '照準を輪に合わせてクリックしたまま', k_hook_sp: '輪を押したまま／右下のボタンを押したまま', k_rel: '離す', k_rel_pc: 'ボタンを離す', k_rel_sp: '指を離す', k_pump: 'こぐ', k_pump_sp: '左下のボタン', k_look: '見回す・狙う', k_look_pc: 'マウスを動かす（クリックで固定・Esc で解除）', k_look_sp: '何もない所をなぞる', k_cp: '旗へ戻る', k_cp_sp: '右上の矢印',
    tip1: '届く輪は金色に光る。光っていない輪は、どこかから振れば届く。', tip2: '振れている向きと同じ側を押すと、振れが大きくなる。', tip3: '飛んでいる間に輪を押しておくと、届いた瞬間に掛かる。遠くで掛けるほどワイヤーは長くなる。振れの頂点の手前で風の音が変わったら、離しどき。', tip4: 'ひびの入った台座は掛けると崩れる。錆びた輪は一度離すと折れる。',
    credit: '素材: Quaternius・Poly Haven・Kenney・rubberduck・artisticdude ほか（CC0）',
    falls: '落下', arrived: '頂上', time: '時間', best: '自己ベスト', retry: 'もう一回', share: 'Xでポスト', menu: 'メニュー', paused: '一時停止', resume: '続ける', tocp: '旗へ戻る', back: 'もどる',
    t_walk0_pc: 'D か → で右へ。光る輪に近づく', t_walk0_sp: '右のボタンで歩いて、光る輪に近づく', t_grab_pc: '照準を光る輪に合わせて、クリックしたまま', t_grab_sp: '光る輪を押したまま（右下のボタンでも）', t_walk: 'そのまま右へ。崖から振り出す', t_pump_pc: 'A D でこいで振れを大きく', t_pump_sp: '左下のボタンでこいで振れを大きく', t_rel: '振れの上で離して、次の輪へ', t_next: '飛びながら次の輪を押す',
    saved: '旗', top: '頂上', fellback: '旗へ戻った', sec: { base: '基部', crumble: '崩れ回廊', wind: '風の段', bell: '鐘楼', mill: '風車の層', shaft: '鉄球の縦穴', sand: '砂の滝', crown: '頂の門' },
    best_fmt: b => '自己ベスト ' + b, share_txt: (t, f) => `SKY HOOK 頂上まで ${t}（落下 ${f}回）`,
  },
  en: {
    loading: 'Heading to the tower', kicker: 'Above the clouds, one swing at a time.', logo_sub: 'Climb a sandstone tower on a short wire', start: 'Climb', cont: 'Continue from flag', how: 'How to play', sound_on: 'Sound on', sound_off: 'Sound off',
    how_lead: 'Your wire is short and cannot reel in. Pick a ring, pump left and right to build the swing, let go just before the top of the arc and fly to the next ring.',
    k_hook: 'Hook', k_hook_pc: 'Aim at a ring, hold the mouse button', k_hook_sp: 'Hold a ring, or hold the hook button', k_rel: 'Let go', k_rel_pc: 'Release the button', k_rel_sp: 'Lift your finger', k_pump: 'Pump', k_pump_sp: 'Buttons bottom left', k_look: 'Look / aim', k_look_pc: 'Move the mouse (click to lock, Esc to release)', k_look_sp: 'Drag empty space', k_cp: 'Back to flag', k_cp_sp: 'Arrow top right',
    tip1: 'Rings in reach glow gold. A dark ring can be reached if you swing from the right place.', tip2: 'Push the same way you are swinging to swing higher.', tip3: 'Hold a ring while flying and you hook the moment it is in reach. Hooking from farther gives a longer wire.', tip4: 'Cracked mounts crumble when hooked. Rusty rings snap after one use.',
    credit: 'Assets: Quaternius, Poly Haven, Kenney, rubberduck, artisticdude and others (CC0)',
    falls: 'Falls', arrived: 'Summit', time: 'Time', best: 'Best', retry: 'Again', share: 'Post on X', menu: 'Menu', paused: 'Paused', resume: 'Resume', tocp: 'Back to flag', back: 'Back',
    t_walk0_pc: 'Walk right with D or the arrow key', t_walk0_sp: 'Walk right toward a glowing ring', t_grab_pc: 'Aim at a glowing ring and hold the mouse button', t_grab_sp: 'Hold a glowing ring (or the hook button)', t_walk: 'Keep going right. Swing off the edge', t_pump_pc: 'Pump with A / D', t_pump_sp: 'Pump with the buttons bottom left', t_rel: 'Let go near the top of the swing', t_next: 'Hold the next ring while flying',
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
      c = pow(c, vec3(2.35));
      float lum = dot(c, vec3(0.3, 0.59, 0.11)); c = mix(vec3(lum), c, 1.25);
      c = mix(c, c * vec3(0.78, 0.93, 1.22), smoothstep(0.5, 0.75, v));
      float s = max(dot(d, sunDir), 0.0);
      c += vec3(1.0, 0.86, 0.6) * (pow(s, 900.0) * 30.0 + pow(s, 30.0) * 0.25 + pow(s, 6.0) * 0.04);
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
scene.fog = new THREE.FogExp2(0xa9bcd8, 0.0009)

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
      c.rgb = mix(vec3(l), c.rgb, 1.14);
      c.rgb = (c.rgb - 0.5) * 1.06 + 0.5;
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

// ------------------------------------------------------------ 入力（肩越し: 画面中央の照準で輪を狙う）
const keys = new Set()
const inp = { hook: false, target: -1, pump: 0 }
let hover = -1          // 照準が重なっている輪
let touchPump = 0
const pointers = new Map()      // id -> {kind:'hook'|'look', x, y}
const look = { yaw: 0, pitch: 0.42, t: -1e9 }   // yaw + で右（周の +x）、pitch + で上
let mode = 'loading', paused = false
let locked = false

addEventListener('keydown', e => {
  if (e.repeat) return
  keys.add(e.code)
  if (mode !== 'play') return
  if (e.code === 'Escape' || e.code === 'KeyP') setPause(!paused)
  if (e.code === 'KeyR' && !paused) toFlag()
  if (e.code === 'Space') { e.preventDefault(); pointers.set('key', { kind: 'hook' }); inp.hook = true; inp.target = hover }
})
addEventListener('keyup', e => {
  keys.delete(e.code)
  if (e.code === 'Space' && pointers.get('key')) { pointers.delete('key'); releaseHookIfNone() }
})
const _v = new THREE.Vector3(), _q = { x: 0, y: 0 }, _d = new THREE.Vector3()
function usableA(a) { const st = S.an[a.i]; return !((a.kind === 'rusty' && st.used) || st.back > 0 || st.fallT > 0 || (a.hidden && S.bell[a.hidden.g] == null)) }
// 照準（カメラの視線）に一番近い輪。視線そのもので取るので、肩越しの視差でずれない。
// 判定は輪の周り 0.75m か 2.6 度の広い方。吸い付き（照準を動かす）はしない
export function aimPick(dir, origin) {
  const o = origin || camera.position
  let best = -1, bs = 1e9
  const gset = new Set(grabbable(W, S))
  for (const a of W.anchors) {
    if (Math.abs(a.y - S.p.y) > 40 || !usableA(a)) continue
    anchorPos(W, S, a, _q); to3(_q.x, _q.y, 0, _v)
    _d.copy(_v).sub(o); const dist = _d.length(); if (dist < 0.5) continue
    _d.divideScalar(dist)
    const ang = Math.acos(Math.max(-1, Math.min(1, _d.dot(dir))))
    const tol = Math.max(2.6 * Math.PI / 180, Math.atan(0.75 / dist))
    if (ang > tol) continue
    const sc = ang / tol - (gset.has(a.i) ? 0.25 : 0)
    if (sc < bs) { bs = sc; best = a.i }
  }
  return best
}
const _f = new THREE.Vector3(), _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2()
function centerDir() { camera.getWorldDirection(_f); return _f }
// 画面のある点（指で直接押した点）を通る視線で取る
export function pickAt(cx, cy) {
  const rc = renderer.domElement.getBoundingClientRect()
  _ndc.set((cx - rc.left) / rc.width * 2 - 1, -((cy - rc.top) / rc.height) * 2 + 1)
  _ray.setFromCamera(_ndc, camera)
  // 指は照準より太いので、判定を少し広げる
  let best = -1, bs = 1e9
  const gset = new Set(grabbable(W, S))
  for (const a of W.anchors) {
    if (Math.abs(a.y - S.p.y) > 40 || !usableA(a)) continue
    anchorPos(W, S, a, _q); to3(_q.x, _q.y, 0, _v)
    _d.copy(_v).sub(_ray.ray.origin); const dist = _d.length(); _d.divideScalar(dist)
    const ang = Math.acos(Math.max(-1, Math.min(1, _d.dot(_ray.ray.direction))))
    const tol = Math.max(5 * Math.PI / 180, Math.atan(1.1 / dist))
    if (ang > tol) continue
    const sc = ang / tol - (gset.has(a.i) ? 0.25 : 0)
    if (sc < bs) { bs = sc; best = a.i }
  }
  return best
}
function releaseHookIfNone() {
  for (const p of pointers.values()) if (p.kind === 'hook') return
  inp.hook = false; inp.target = -1
}
const cv = renderer.domElement
const SENS_M = 0.0024, SENS_T = 0.0062
function turn(dx, dy, k) { look.yaw = Math.max(-1.25, Math.min(1.25, look.yaw + dx * k)); look.pitch = Math.max(-0.7, Math.min(1.25, look.pitch - dy * k)); look.t = performance.now() }
document.addEventListener('pointerlockchange', () => {
  const was = locked; locked = document.pointerLockElement === cv
  // Esc で固定が外れたら一時停止（ボタンを押せるように）
  if (was && !locked && mode === 'play' && !paused) setPause(true)
})
function unlock() { try { if (document.pointerLockElement) document.exitPointerLock() } catch (e) {} }
cv.addEventListener('pointerdown', e => {
  startAudio()
  if (mode !== 'play' || paused) return
  e.preventDefault()
  try { cv.setPointerCapture(e.pointerId) } catch (er) {}
  if (e.pointerType === 'mouse') {
    if (!locked && !Q.has('nolock')) { try { cv.requestPointerLock() } catch (er) {} }
    if (e.button === 2) { pointers.set(e.pointerId, { kind: 'look', x: e.clientX, y: e.clientY }); return }
    pointers.set(e.pointerId, { kind: 'hook' }); inp.hook = true; inp.target = hover; tutHooked = true
    return
  }
  // 指: 輪を直接押したら掛ける。それ以外はなぞって見回す
  const i = pickAt(e.clientX, e.clientY)
  if (i >= 0) { pointers.set(e.pointerId, { kind: 'hook', x: e.clientX, y: e.clientY }); inp.hook = true; inp.target = i; tutHooked = true }
  else pointers.set(e.pointerId, { kind: 'look', x: e.clientX, y: e.clientY })
})
addEventListener('pointermove', e => {
  if (mode !== 'play' || paused) return
  if (locked && e.pointerType === 'mouse') { turn(e.movementX, e.movementY, SENS_M); return }
  const p = pointers.get(e.pointerId)
  if (!p || p.kind !== 'look') return
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY
  turn(dx, dy, e.pointerType === 'mouse' ? SENS_M : SENS_T)
})
const endPtr = e => { if (!pointers.has(e.pointerId)) return; pointers.delete(e.pointerId); releaseHookIfNone() }
addEventListener('pointerup', endPtr); addEventListener('pointercancel', endPtr)
for (const b of document.querySelectorAll('.pump')) {
  const k = +b.dataset.k
  b.addEventListener('pointerdown', e => { e.preventDefault(); startAudio(); touchPump = k; b.classList.add('on'); try { b.setPointerCapture(e.pointerId) } catch (er) {} })
  const up = () => { if (touchPump === k) touchPump = 0; b.classList.remove('on') }
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up)
}
// スマホの「掛ける」ボタン: 押している間、照準の輪に掛かる（押した後に照準へ入った輪にも掛かる）
{
  const b = $('hookBtn')
  b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); startAudio(); pointers.set('btn' + e.pointerId, { kind: 'hook' }); inp.hook = true; inp.target = hover; b.classList.add('on'); tutHooked = true; try { b.setPointerCapture(e.pointerId) } catch (er) {} })
  const up = e => { pointers.delete('btn' + e.pointerId); b.classList.remove('on'); releaseHookIfNone() }
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up)
}
function gatherPump() {
  let u = touchPump
  if (keys.has('KeyA') || keys.has('ArrowLeft')) u -= 1
  if (keys.has('KeyD') || keys.has('ArrowRight')) u += 1
  return Math.max(-1, Math.min(1, u))
}

// ------------------------------------------------------------ カメラ（右肩の少し後ろ・上）
// 振っている間は少し引いて、ワイヤー・掛け点・体が入るようにする。振れに合わせて大きく揺らさない
const cam = { x: 0, y: 0, pull: 0, pos: new THREE.Vector3(), fovK: 0, tilt: 0 }
const _n = new THREE.Vector3(), _t = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _r = new THREE.Vector3(), _fw = new THREE.Vector3(), _p3 = new THREE.Vector3()
function lookDir(out) {
  const fr = frame(cam.x)
  const cy = Math.cos(look.yaw), sy = Math.sin(look.yaw), cp = Math.cos(look.pitch), sp = Math.sin(look.pitch)
  return out.copy(fr.n).multiplyScalar(-cy * cp).addScaledVector(fr.t, sy * cp).addScaledVector(_up, sp).normalize()
}
function updateCamera(dt, snap) {
  const p = S.p
  const k = snap ? 1 : 1 - Math.exp(-dt * 10)
  cam.x += (p.x - cam.x) * k; cam.y += (p.y + (S.p.ground && !S.rope ? 0.9 : 0.4) - cam.y) * k
  // 振っている間は引く
  const pullT = S.rope ? 2.6 : (p.ground ? 0 : 1.2)
  cam.pull += (pullT - cam.pull) * (snap ? 1 : 1 - Math.exp(-dt * 2.2))
  // 掛けている間、しばらく見回していなければ、掛け点と体の間へ少しだけ向ける（弱く）
  if (S.rope && performance.now() - look.t > 1400) {
    const q = anchorPos(W, S, W.anchors[S.rope.i], { x: 0, y: 0 })
    const fr = frame(cam.x)
    to3((q.x + p.x) / 2, (q.y + p.y) / 2 + 1, 0, _p3)
    _d.copy(_p3).sub(to3(p.x, p.y, 4 + cam.pull)).normalize()
    const wantYaw = Math.atan2(_d.dot(fr.t), -_d.dot(fr.n)), wantPitch = Math.asin(Math.max(-1, Math.min(1, _d.y)))
    const kk = 1 - Math.exp(-dt * 0.8)
    look.yaw += (Math.max(-1, Math.min(1, wantYaw)) - look.yaw) * kk; look.pitch += (Math.max(-0.3, Math.min(1.1, wantPitch)) - look.pitch) * kk
  }
  lookDir(_fw)
  _r.crossVectors(_fw, _up).normalize()
  const portrait = camera.aspect < 1
  const D = (DBG.camD || (portrait ? 6.2 : 3.8)) + cam.pull
  to3(cam.x, cam.y, 0, _p3)
  cam.pos.copy(_p3).addScaledVector(_r, portrait ? 0.45 : 0.8).addScaledVector(_up, 0.55).addScaledVector(_fw, -D)
  // カメラの当たり: 塔の柱や棚の前面より外（遊ぶ面から 1.3m）に保つ（壁にめり込まない）
  const rr = Math.hypot(cam.pos.x, cam.pos.z), minR = TOWER_R + 1.3
  if (rr < minR) { cam.pos.x *= minR / rr; cam.pos.z *= minR / rr }
  camera.position.copy(cam.pos)
  camera.up.set(0, 1, 0)
  camera.lookAt(_p3.copy(cam.pos).add(_fw))
  const sp = Math.hypot(p.vx, p.vy)
  const tilt = S.rope ? Math.max(-0.035, Math.min(0.035, -p.vx * 0.003)) : 0
  cam.tilt += (tilt - cam.tilt) * (1 - Math.exp(-dt * 2))
  camera.rotateZ(cam.tilt)
  const fovT = (portrait ? 82 : 64) + Math.min(10, Math.max(0, sp - 8) * 0.7) + cam.fovK
  cam.fovK *= Math.exp(-dt * 5)
  if (Math.abs(camera.fov - fovT) > 0.05) { camera.fov += (fovT - camera.fov) * (1 - Math.exp(-dt * 4)); camera.updateProjectionMatrix() }
  placeSun(p.x, p.y)
  // 照準の輪（毎コマ）
  camera.updateMatrixWorld()
  hover = mode === 'play' ? aimPick(centerDir()) : -1
  // 押したまま照準を輪に入れたら、その輪を狙う
  if (inp.hook && inp.target < 0 && !S.rope) inp.target = hover
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
function show(id) { $('finger').classList.remove('on'); for (const s of ['loading', 'title', 'how', 'result', 'pause']) $(s).hidden = s !== id }
// 高度計（旗の位置に印）
const yMin = 0, yMax = Math.max(...course.anchors.map(a => a.y)) + 4
function altY(y) { return Math.max(0, Math.min(1, (y - yMin) / (yMax - yMin))) }
$('altTop').textContent = Math.round(course.top.y) + 'm'
for (const f of course.flags) { const d = document.createElement('div'); d.className = 'fl'; d.style.bottom = (altY(f.y) * 100) + '%'; $('altTrack').appendChild(d) }

// チュートリアル（最初の1回だけ・同時に1つ）
let tutHooked = false, tutStage = 0
function tutorial() {
  const el = $('tut')
  if (S.cp >= 0 || tutStage >= 5) { el.classList.remove('on'); $('finger').classList.remove('on'); return }
  let msg = ''
  if (tutStage === 0) { msg = grabbable(W, S).length ? t(isTouch ? 't_grab_sp' : 't_grab_pc') : t(isTouch ? 't_walk0_sp' : 't_walk0_pc'); if (S.rope) tutStage = 1 }
  else if (tutStage === 1) { msg = S.p.ground ? t('t_walk') : t(isTouch ? 't_pump_sp' : 't_pump_pc'); const si = swingInfo(W, S); if (si && si.thMax > 1.2) tutStage = 2; if (!S.rope) tutStage = 0 }
  else if (tutStage === 2) { msg = t('t_rel'); if (!S.rope) tutStage = 3 }
  else if (tutStage === 3) { msg = t('t_next'); if (S.rope && S.rope.i !== 0) tutStage = 5 }
  el.textContent = msg; el.classList.toggle('on', !!msg)
  // スマホの最初の1手: 押す輪の上に指を出す
  const fg = $('finger')
  const g0 = tutStage === 0 && isTouch ? grabbable(W, S)[0] : undefined
  if (g0 != null) { const q = window.hook.anchorXY(g0); fg.style.left = q.x + 'px'; fg.style.top = q.y + 'px'; fg.classList.add('on') } else fg.classList.remove('on')
}

function setPause(v) { paused = v; $('pause').hidden = !v; if (v) { pointers.clear(); inp.hook = false; inp.target = -1; unlock() } }
function toFlag() { respawn(W, S, false); onRespawn(); setPause(false) }
function onRespawn() { pointers.clear(); inp.hook = false; inp.target = -1; flash(); faceFlagRing() }
// 旗に戻った時は、旗の輪の方を向く（照準は合わせない。向きだけ）
function faceFlagRing() {
  if (S.cp < 0) { look.yaw = 0.3; look.pitch = 0.42; return }
  const a = W.anchors[W.flags[S.cp].a]
  look.yaw = Math.max(-1, Math.min(1, Math.atan2(a.x - S.p.x, 7))); look.pitch = 0.5
}
function startGame(fromCp) {
  S = newState(W)
  const pr = fromCp ? loadProgress() : null
  if (pr && pr.cp >= 0 && W.flags[pr.cp]) { const f = W.flags[pr.cp]; S.cp = pr.cp; S.cpX = f.x; S.cpY = f.y + 0.6; S.p.x = S.cpX; S.p.y = S.cpY; S.t = pr.t || 0; S.falls = pr.falls || 0; tutStage = 5 }
  else tutStage = 0
  mode = 'play'; paused = false
  show(null); $('hud').hidden = false; $('touch').hidden = !isTouch
  look.yaw = 0; look.pitch = 0.42
  updateCamera(0, true)
  startAudio()
}
function finish() {
  mode = 'result'; unlock()
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
function toTitle() { mode = 'title'; unlock(); show('title'); $('hud').hidden = true; $('touch').hidden = true; const pr = loadProgress(); $('contBtn').hidden = !(pr && pr.cp >= 0); S = newState(W); refreshBest() }

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
let skyYaw = 0, apexT = 0
let acc = 0, last = performance.now(), fpsN = 0, fpsT = 0
window.__fps = 0
function frameLoop(now) {
  requestAnimationFrame(frameLoop)
  let dt = Math.min(0.1, (now - last) / 1000); last = now
  fpsN++; fpsT += dt; if (fpsT > 1) { window.__fps = fpsN / fpsT; fpsN = 0; fpsT = 0 }
  if (DBG.frozen) dt = 0
  if (mode === 'play' && !paused) {
    if (hitStop > 0) { hitStop -= dt; dt *= 0.15 }
    // 振れの頂点の手前: 少しだけ遅くし、きしむ音で「今離すと高く飛ぶ」を伝える
    const si = S.rope ? swingInfo(W, S) : null
    const nearApex = si && si.thMax > 0.85 && Math.abs(si.th) > si.thMax - 0.22 && S.p.vx * si.th > 0
    if (nearApex) { dt *= 0.82; if (performance.now() - apexT > 700) { apexT = performance.now(); Snd.play('creak', { vol: 0.35 }); $('reticle').classList.add('apex'); setTimeout(() => $('reticle').classList.remove('apex'), 260) } }
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
  view.update(S, { grabbable: grabs, hover, target: inp.target, hand: climber.hand, camX: cam.x, camY: cam.y }, dt, camera)
  if (mode === 'title') {
    const a = S.t * 0.05
    cam.x = -8 + Math.sin(a) * 10; cam.y = 14 + Math.sin(a * 0.7) * 6
    cam.d = 34
    to3(cam.x + 14, cam.y - 8, 30, camera.position); camera.lookAt(to3(cam.x - 4, cam.y + 6, 0))
    if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix() }
    placeSun(cam.x, cam.y)
  } else updateCamera(dt, false)
  if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 0.5; camera.position.y += (Math.random() - 0.5) * shake * 0.5; shake = Math.max(0, shake - dt * 1.6) }
  // 空の絵: 明るい青空の側がいつも前に来るよう、カメラの向きに 7 割ついて回す（残り 3 割で回り込む感じを残す）
  sky.position.copy(camera.position)
  { const e = camera.matrixWorld.elements; const af = Math.atan2(-e[8], e[10]) / (2 * Math.PI) + 0.5
    skyYaw = 0.62 - af * 0.7 - 0.3 * 0.5
    skyMat.uniforms.yaw.value = skyYaw }
  const sp = Math.hypot(S.p.vx, S.p.vy)
  drawSpeed(mode === 'play' ? sp : 0, dt)
  if (Snd.ctx && Snd.loops.wind && Snd.loops.wind.gain) { const g = Snd.loops.wind.gain.gain; g.value += (Math.min(0.55, Math.max(0, sp - 6) / 24) - g.value) * 0.08 }
  $('reticle').classList.toggle('hot', mode === 'play' && hover >= 0 && grabs.includes(hover))
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
  W, get S() { return S }, set S(v) { S = v }, PH, DBG, camera, pickAt, aimPick, climber, look, get hover() { return hover },
  // 照準を i 番の輪へ向ける（検査用）。カメラの位置は向きで変わるので数回まわして合わせる
  aimAt(i) { for (let k = 0; k < 6; k++) { updateCamera(0, true); anchorPos(W, S, W.anchors[i], _q); to3(_q.x, _q.y, 0, _v); const fr = frame(cam.x); _d.copy(_v).sub(camera.position).normalize(); look.yaw = Math.atan2(_d.dot(fr.t), -_d.dot(fr.n)); look.pitch = Math.asin(_d.y) } look.t = performance.now(); updateCamera(0, true); return hover },
  anchorXY(i) { anchorPos(W, S, W.anchors[i], _q); to3(_q.x, _q.y, 0, _v); _v.project(camera); const rc = renderer.domElement.getBoundingClientRect(); return { x: rc.left + (_v.x + 1) / 2 * rc.width, y: rc.top + (1 - _v.y) / 2 * rc.height } },
  start: (cp) => startGame(cp), get mode() { return mode }, grabbable: () => grabbable(W, S),
  place(x, y) { S.p.x = x; S.p.y = y; S.p.vx = S.p.vy = 0; S.rope = null; updateCamera(0, true) },
  warpFlag(i) { const f = W.flags[i]; S.cp = i; S.cpX = f.x; S.cpY = f.y + 0.6; respawn(W, S, false); faceFlagRing(); updateCamera(0, true) },
  frame(n = 1, input) { for (let k = 0; k < n; k++) { step(W, S, input || inp); events() } updateCamera(0, true) },
}

// ------------------------------------------------------------ 読み込み
async function boot() {
  // 準備完了は最初の画面に要る物（空の絵）だけ。人物の模型と質感は裏で読み続ける（届くまで仮の形と色）
  const fill = $('ldFill')
  fill.style.width = '30%'
  const texP = new Promise(res => { new THREE.TextureLoader().load('assets/pano.webp', tx => {
    tx.colorSpace = THREE.NoColorSpace; tx.minFilter = THREE.LinearFilter; tx.generateMipmaps = false; skyMat.uniforms.map.value = tx
    // 映り込みの光も同じ空の絵から作る（HDR を別に読まない）
    try { const t2 = tx.clone(); t2.colorSpace = THREE.SRGBColorSpace; t2.mapping = THREE.EquirectangularReflectionMapping; t2.needsUpdate = true; const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromEquirectangular(t2).texture; scene.environmentIntensity = 0.5; pm.dispose() } catch (e) {}
    fill.style.width = '100%'; res() }, undefined, () => res()) })
  climber.load('assets/models/Rider.glb').catch(e => console.warn(e))
  await Promise.race([texP, new Promise(r => setTimeout(r, 9000))])
  applyLang()
  const pr = loadProgress(); $('contBtn').hidden = !(pr && pr.cp >= 0)
  if (Q.has('play')) startGame(Q.get('play') === 'cp')
  else { mode = 'title'; show('title') }
  window.__hookReady = true
}
applyLang()
requestAnimationFrame(frameLoop)
boot()
