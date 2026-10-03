/**
 * Tiny Apex — transient cosmetic effects (bounded pools).
 *
 * Two short-lived effect kinds, both allocated once and recycled:
 *   - Tire marks: dark quads laid on the road behind the rear wheels
 *     while steering, fading over a couple of seconds.
 *   - Dust: small puffs kicked up at the same spots.
 *
 * Pools have a hard size cap, so effects can never grow unbounded.
 * All of it is purely cosmetic: it never touches the simulation.
 */

import * as THREE from 'three';

export interface WheelEmitters {
  /** World-space positions of the rear wheels. */
  left: THREE.Vector3;
  right: THREE.Vector3;
}

const TIRE_MARK_LIFE = 2.2;
const DUST_LIFE = 0.8;

interface TireMark {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  age: number;
  active: boolean;
}

interface DustPuff {
  mesh: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  age: number;
  life: number;
  vx: number;
  vy: number;
  vz: number;
  active: boolean;
}

export class Effects {
  private tireMarks: TireMark[] = [];
  private dust: DustPuff[] = [];
  private tireCursor = 0;
  private dustCursor = 0;
  private tireAccum = 0;
  private dustAccum = 0;
  readonly group = new THREE.Group();

  constructor(scene: THREE.Scene, private reducedMotion: boolean) {
    // Tire marks: recycled quads lying flat on the road.
    const markGeo = new THREE.PlaneGeometry(0.16, 0.55);
    markGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 220; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x26262b,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(markGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 1;
      this.tireMarks.push({ mesh, age: 0, active: false });
      this.group.add(mesh);
    }

    // Dust: recycled low-poly puffs.
    const dustGeo = new THREE.IcosahedronGeometry(0.09, 0);
    for (let i = 0; i < 48; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xd9be93,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(dustGeo, mat);
      mesh.visible = false;
      this.dust.push({
        mesh,
        age: 0,
        life: DUST_LIFE,
        vx: 0,
        vy: 0,
        vz: 0,
        active: false,
      });
      this.group.add(mesh);
    }

    scene.add(this.group);
  }

  /**
   * Emit effects for the current frame. `steering` is the cosmetic
   * drift signal; the car's speed and heading position the puffs.
   */
  emit(dt: number, steering: boolean, emitters: WheelEmitters, heading: number): void {
    if (this.reducedMotion || !steering) {
      return;
    }

    this.tireAccum += dt;
    if (this.tireAccum >= 0.03) {
      this.tireAccum = 0;
      for (const pos of [emitters.left, emitters.right]) {
        const mark = this.tireMarks[this.tireCursor];
        this.tireCursor = (this.tireCursor + 1) % this.tireMarks.length;
        mark.mesh.position.set(pos.x, 0.045, pos.z);
        mark.mesh.rotation.y = heading;
        mark.age = 0;
        mark.active = true;
        mark.mesh.visible = true;
      }
    }

    this.dustAccum += dt;
    if (this.dustAccum >= 0.05) {
      this.dustAccum = 0;
      const pos = this.dustCursor % 2 === 0 ? emitters.left : emitters.right;
      this.dustCursor++;
      const puff = this.dust[this.dustCursor % this.dust.length];
      puff.mesh.position.set(pos.x, 0.12, pos.z);
      puff.vx = (Math.random() - 0.5) * 0.5 - Math.sin(heading) * 0.4;
      puff.vz = (Math.random() - 0.5) * 0.5 - Math.cos(heading) * 0.4;
      puff.vy = 0.5 + Math.random() * 0.4;
      puff.age = 0;
      puff.life = DUST_LIFE * (0.7 + Math.random() * 0.5);
      puff.active = true;
      puff.mesh.visible = true;
    }
  }

  update(dt: number): void {
    for (const mark of this.tireMarks) {
      if (!mark.active) continue;
      mark.age += dt;
      const k = 1 - mark.age / TIRE_MARK_LIFE;
      if (k <= 0) {
        mark.active = false;
        mark.mesh.visible = false;
      } else {
        mark.mesh.material.opacity = 0.34 * k;
      }
    }
    for (const puff of this.dust) {
      if (!puff.active) continue;
      puff.age += dt;
      const k = 1 - puff.age / puff.life;
      if (k <= 0) {
        puff.active = false;
        puff.mesh.visible = false;
        continue;
      }
      puff.mesh.position.x += puff.vx * dt;
      puff.mesh.position.y += puff.vy * dt;
      puff.mesh.position.z += puff.vz * dt;
      const grow = 1 + (1 - k) * 1.6;
      puff.mesh.scale.setScalar(grow);
      puff.mesh.material.opacity = 0.45 * k;
    }
  }

  /** Deactivate everything (restart). */
  clear(): void {
    for (const mark of this.tireMarks) {
      mark.active = false;
      mark.mesh.visible = false;
    }
    for (const puff of this.dust) {
      puff.active = false;
      puff.mesh.visible = false;
    }
  }

  dispose(scene: THREE.Scene): void {
    this.clear();
    scene.remove(this.group);
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        obj.material.dispose();
      }
    });
  }
}
