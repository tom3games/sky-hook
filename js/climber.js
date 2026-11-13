// 登る人。Quaternius の人物（CC0）を骨の IK で手続きに動かす（アニメのクリップは使わない）
import * as THREE from 'three'
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js'
import { to3, frame } from './view.js?v=4'

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const _a = V(), _b = V(), _c = V()
function aim(bone, childW, targetW) {
  const bw = bone.getWorldPosition(V())
  const from = childW.clone().sub(bw).normalize(), to = targetW.clone().sub(bw).normalize()
  const dq = new THREE.Quaternion().setFromUnitVectors(from, to)
  const wq = bone.getWorldQuaternion(new THREE.Quaternion()), pq = bone.parent.getWorldQuaternion(new THREE.Quaternion())
  bone.quaternion.copy(pq.invert().multiply(dq.multiply(wq)))
  bone.updateMatrixWorld(true)
}
function ik2(A, B, C, target, pole) {
  if (!A || !B || !C) return
  A.getWorldPosition(_a); B.getWorldPosition(_b); C.getWorldPosition(_c)
  const l1 = _a.distanceTo(_b), l2 = _b.distanceTo(_c)
  const d = target.clone().sub(_a), L = Math.max(0.05, Math.min(l1 + l2 - 0.002, d.length())), u = d.normalize()
  const cosA = Math.max(-1, Math.min(1, (l1 * l1 + L * L - l2 * l2) / (2 * l1 * L))), sinA = Math.sqrt(1 - cosA * cosA)
  const pv = pole.clone().sub(_a); pv.sub(u.clone().multiplyScalar(pv.dot(u))).normalize()
  const bD = _a.clone().addScaledVector(u, l1 * cosA).addScaledVector(pv, l1 * sinA)
  aim(A, _b.clone(), bD)
  B.getWorldPosition(_b); C.getWorldPosition(_c)
  aim(B, _c.clone(), _a.clone().addScaledVector(u, L))
}

export class Climber {
  constructor(scene) {
    this.root = new THREE.Group(); scene.add(this.root)
    this.body = new THREE.Group(); this.root.add(this.body)
    this.ready = false
    this.up = V(0, 1, 0)
    this.hand = V()
    this.walkPh = 0
    // 首の赤い布（速さと逆へなびく。遠くでも人の向きと速さが読める）
    this.scarfN = 12
    this.scarfP = Array.from({ length: this.scarfN }, () => V())
    this.scarfO = this.scarfP.map(() => V())
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.scarfN * 2 * 3), 3))
    const idx = []; for (let i = 0; i < this.scarfN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
    sg.setIndex(idx)
    this.scarf = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: 0xa8382a, roughness: 0.9, side: THREE.DoubleSide }))
    this.scarf.frustumCulled = false; this.scarf.castShadow = true
    scene.add(this.scarf)
    this.scarfInit = false
    // 読み込むまでの仮の形（細い柱。見えない人にしない）
    const tmp = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.1, 4, 8), new THREE.MeshStandardMaterial({ color: 0x3a3430, roughness: 0.8 }))
    tmp.castShadow = true; this.tmp = tmp; this.body.add(tmp)
  }
  async load(url) {
    const gl = await new GLTFLoader().loadAsync(url)
    const m = gl.scene
    m.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.frustumCulled = false
        if (o.material) { o.material = o.material.clone(); o.material.roughness = Math.max(0.6, o.material.roughness ?? 0.7); o.material.metalness = 0.05; if (o.material.color) o.material.color.lerp(new THREE.Color(0xb88a5a), 0.45); o.material.emissive = new THREE.Color(0x2a1a10) }
      }
    })
    const box = new THREE.Box3().setFromObject(m), h = box.max.y - box.min.y
    m.scale.setScalar(2.0 / h)
    this.body.add(m)
    const bone = n => m.getObjectByName(n) || m.getObjectByName(n.replace(/[.]/g, ''))
    this.B = {}
    for (const n of ['Hips', 'Abdomen', 'Torso', 'Chest', 'Neck', 'Head', 'UpperArm.L', 'LowerArm.L', 'Wrist.L', 'UpperArm.R', 'LowerArm.R', 'Wrist.R', 'UpperLeg.L', 'LowerLeg.L', 'Foot.L', 'UpperLeg.R', 'LowerLeg.R', 'Foot.R']) { const b = bone(n); if (b) { this.B[n] = b; b.userData.q0 = b.quaternion.clone() } }
    this.model = m
    this.ready = !!(this.B.Hips && this.B['UpperArm.L'] && this.B['Foot.L'])
    if (this.ready) this.tmp.visible = false
    // 模型の胸の高さを実測して、物理の点（胸）に合わせる
    m.updateMatrixWorld(true)
    const chest = (this.B.Chest || this.B.Torso || this.B.Hips).getWorldPosition(V())
    m.position.y -= chest.y - this.root.position.y
  }
  updateScarf(dt, camPos) {
    const B = this.B
    const neck = (B && (B.Neck || B.Chest)) ? (B.Neck || B.Chest).getWorldPosition(V()) : this.root.position.clone().addScaledVector(this.up, 0.5)
    const P = this.scarfP, O = this.scarfO, n = this.scarfN, seg = 0.13
    if (!this.scarfInit || neck.distanceTo(P[0]) > 3) { for (let i = 0; i < n; i++) { P[i].copy(neck).y -= i * seg; O[i].copy(P[i]) } this.scarfInit = true }
    const h = Math.min(dt, 1 / 30)
    P[0].copy(neck); O[0].copy(neck)
    for (let i = 1; i < n; i++) {
      const v = P[i].clone().sub(O[i]).multiplyScalar(0.94)
      O[i].copy(P[i]); P[i].add(v); P[i].y -= 3.5 * h * h
      // 風で少しはためく
      P[i].x += Math.sin(performance.now() * 0.011 + i) * 0.004 * i
    }
    for (let k = 0; k < 3; k++) for (let i = 1; i < n; i++) { const d = P[i].clone().sub(P[i - 1]), L = d.length() || 1e-6; P[i].copy(P[i - 1]).addScaledVector(d, seg / L) }
    const pos = this.scarf.geometry.attributes.position
    for (let i = 0; i < n; i++) {
      const dir = (i < n - 1 ? P[i + 1].clone().sub(P[i]) : P[i].clone().sub(P[i - 1])).normalize()
      const toCam = camPos.clone().sub(P[i]).normalize()
      const side = new THREE.Vector3().crossVectors(dir, toCam).normalize().multiplyScalar(0.14 * (1 - i / n * 0.3))
      pos.setXYZ(i * 2, P[i].x + side.x, P[i].y + side.y, P[i].z + side.z)
      pos.setXYZ(i * 2 + 1, P[i].x - side.x, P[i].y - side.y, P[i].z - side.z)
    }
    pos.needsUpdate = true; this.scarf.geometry.computeVertexNormals(); this.scarf.geometry.computeBoundingSphere()
  }
  // S: 物理の状態、anc: 掛けている点の2次元座標（なければ null）、aimAt: 狙っている点、dt
  update(S, anc, aimAt, dt, camPos) {
    this._update(S, anc, aimAt, dt)
    if (camPos) this.updateScarf(dt, camPos)
  }
  _update(S, anc, aimAt, dt) {
    const p = S.p
    // 立っている時は足を地面に（物理の点は体の中心の低い所。ぶら下がる時は胸）
    const lift = p.ground && !anc ? 0.97 : 0
    this.lift = (this.lift ?? lift) + (lift - (this.lift ?? lift)) * Math.min(1, dt * 14)
    const pos = to3(p.x, p.y + this.lift, 0)
    this.root.position.copy(pos)
    const { n, t } = frame(p.x)
    // 体の上の向き: ワイヤーの向き → 無ければ速さで少し傾ける
    let up
    if (anc) { const a3 = to3(anc.x, anc.y, 0); up = a3.sub(pos).normalize() }
    else if (p.ground) up = V(0, 1, 0)
    else { up = V(0, 1, 0).addScaledVector(t, -p.vx * 0.02).normalize() }
    this.up.lerp(up, 1 - Math.exp(-dt * (anc ? 30 : 8))).normalize()
    const u = this.up
    // 正面は壁（-n）。上の向きと直交させる
    const f = n.clone().negate(); f.addScaledVector(u, -f.dot(u)).normalize()
    // 進む向きへ少しだけ体をひねる
    const side = Math.max(-0.5, Math.min(0.5, p.vx * 0.05)) * (p.face || 1)
    const fw = f.clone().applyAxisAngle(u, side * 0.6)
    const r = new THREE.Vector3().crossVectors(u, fw).normalize()
    const M = new THREE.Matrix4().makeBasis(r.clone().negate(), u, fw)
    this.body.quaternion.setFromRotationMatrix(M)
    this.root.updateMatrixWorld(true)
    // 手の位置（ワイヤーの端）
    this.hand.copy(pos).addScaledVector(u, 0.78).addScaledVector(fw, 0.08)
    if (!this.ready) return
    const B = this.B
    for (const k in B) B[k].quaternion.copy(B[k].userData.q0)
    this.body.updateMatrixWorld(true)
    const sp = Math.hypot(p.vx, p.vy)
    if (anc || (aimAt && !p.ground)) {
      // ぶら下がり: 両手でワイヤーをつかむ。体は少し反り、脚は振れと逆へ流れる
      const grip = anc ? this.hand.clone() : pos.clone().add(to3(aimAt.x, aimAt.y, 0).sub(pos).normalize().multiplyScalar(0.95))
      if (!anc) this.hand.copy(grip)
      const rr = r
      ik2(B['UpperArm.L'], B['LowerArm.L'], B['Wrist.L'], grip.clone().addScaledVector(rr, 0.05).addScaledVector(u, 0.06), grip.clone().addScaledVector(rr, 0.6).addScaledVector(fw, -0.4))
      ik2(B['UpperArm.R'], B['LowerArm.R'], B['Wrist.R'], grip.clone().addScaledVector(rr, -0.05).addScaledVector(u, -0.08), grip.clone().addScaledVector(rr, -0.6).addScaledVector(fw, -0.4))
      const trail = t.clone().multiplyScalar(-Math.max(-0.35, Math.min(0.35, p.vx * 0.03)))
      for (const s of ['L', 'R']) {
        const sg = s === 'L' ? 1 : -1
        const hip = B['UpperLeg.' + s].getWorldPosition(V())
        const knee = s === 'L' ? 0.18 : 0.06
        const foot = hip.clone().addScaledVector(u, -0.9 + knee * 0.3).addScaledVector(fw, -0.05 + knee * 0.3).add(trail).addScaledVector(rr, sg * 0.07)
        ik2(B['UpperLeg.' + s], B['LowerLeg.' + s], B['Foot.' + s], foot, hip.clone().addScaledVector(fw, 1))
      }
    } else if (p.ground) {
      // 立つ・歩く
      this.walkPh += Math.abs(p.vx) * dt * 3.2
      for (const s of ['L', 'R']) {
        const sg = s === 'L' ? 1 : -1
        const hip = B['UpperLeg.' + s].getWorldPosition(V())
        const sw = Math.sin(this.walkPh + (s === 'L' ? 0 : Math.PI)) * Math.min(1, Math.abs(p.vx) / 2)
        const foot = hip.clone().addScaledVector(u, -0.88 + Math.max(0, sw) * 0.12).addScaledVector(t, sw * 0.28 * Math.sign(p.vx || 1)).addScaledVector(r, sg * 0.02)
        ik2(B['UpperLeg.' + s], B['LowerLeg.' + s], B['Foot.' + s], foot, hip.clone().addScaledVector(fw, 1))
        const sh = B['UpperArm.' + s].getWorldPosition(V())
        ik2(B['UpperArm.' + s], B['LowerArm.' + s], B['Wrist.' + s], sh.clone().addScaledVector(u, -0.55).addScaledVector(r, -sg * 0.18).addScaledVector(t, -sw * 0.15), sh.clone().addScaledVector(fw, -1))
      }
    } else {
      // 空中: 腕を上へ伸ばし、脚を少したたむ
      for (const s of ['L', 'R']) {
        const sg = s === 'L' ? 1 : -1
        const sh = B['UpperArm.' + s].getWorldPosition(V())
        ik2(B['UpperArm.' + s], B['LowerArm.' + s], B['Wrist.' + s], sh.clone().addScaledVector(u, 0.45).addScaledVector(r, -sg * 0.35).addScaledVector(t, p.vx * 0.015), sh.clone().addScaledVector(fw, -1))
        const hip = B['UpperLeg.' + s].getWorldPosition(V())
        const tuck = Math.min(1, sp / 12)
        ik2(B['UpperLeg.' + s], B['LowerLeg.' + s], B['Foot.' + s], hip.clone().addScaledVector(u, -0.7 + tuck * 0.15).addScaledVector(fw, 0.25 + (s === 'L' ? 0.15 : -0.05)), hip.clone().addScaledVector(fw, 1))
      }
    }
  }
}
