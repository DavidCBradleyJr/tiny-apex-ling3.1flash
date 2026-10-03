/**
 * Tiny Apex — the race car, built entirely from Three.js primitives
 * and a hand-authored extruded silhouette. No external assets.
 *
 * The visible car is compact (1.5 × 1.05 world units) so its body sits
 * reasonably inside the 0.65-radius collision footprint; only the nose
 * and tail tips overhang the circle slightly, arcade-style.
 */

import * as THREE from 'three';

const WHEEL_RADIUS = 0.24;

export interface CarUpdate {
  x: number;
  z: number;
  heading: number;
  /** Held steering (drives the cosmetic lean / drift-yaw). */
  steering: boolean;
  /** 1 while racing, 0 otherwise — wheels only spin while moving. */
  moving: number;
  dt: number;
  reducedMotion: boolean;
}

export class Car {
  readonly group = new THREE.Group();
  private tilt = new THREE.Group();
  private wheels: THREE.Group[] = [];
  private spin = 0;
  private lean = 0;
  private driftYaw = 0;

  constructor() {
    this.group.add(this.tilt);
    this.buildBody();
    this.buildWheels();
  }

  private buildBody(): void {
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xff4b33,
      roughness: 0.32,
      metalness: 0.18,
    });
    const creamMat = new THREE.MeshStandardMaterial({
      color: 0xf5e9cf,
      roughness: 0.5,
      metalness: 0.05,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a3a,
      roughness: 0.12,
      metalness: 0.35,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x26262b,
      roughness: 0.6,
      metalness: 0.2,
    });

    // --- Main hull: top-view silhouette extruded downward, beveled. ---
    const shape = new THREE.Shape();
    shape.moveTo(-0.46, -0.72); // rear, left
    shape.lineTo(0.46, -0.72); // rear, right
    shape.lineTo(0.52, 0.1); // right flank
    shape.quadraticCurveTo(0.52, 0.62, 0.26, 0.75); // nose curve, right
    shape.lineTo(-0.26, 0.75); // nose front
    shape.quadraticCurveTo(-0.52, 0.62, -0.52, 0.1); // nose curve, left
    shape.closePath();

    const bodyGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.18,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.05,
      bevelSegments: 2,
      curveSegments: 10,
    });
    // Extrude runs along +Z; rotate so the silhouette lies in XZ and the
    // extrusion grows downward: shape +Y becomes world +Z (forward).
    bodyGeo.rotateX(Math.PI / 2);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.34;
    body.castShadow = true;
    this.tilt.add(body);

    // --- Cabin canopy ---
    const cabinShape = new THREE.Shape();
    cabinShape.moveTo(-0.3, -0.28);
    cabinShape.lineTo(0.3, -0.28);
    cabinShape.quadraticCurveTo(0.34, 0.1, 0.18, 0.3);
    cabinShape.lineTo(-0.18, 0.3);
    cabinShape.quadraticCurveTo(-0.34, 0.1, -0.3, -0.28);
    const cabinGeo = new THREE.ExtrudeGeometry(cabinShape, {
      depth: 0.14,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 2,
      curveSegments: 8,
    });
    cabinGeo.rotateX(Math.PI / 2);
    const cabin = new THREE.Mesh(cabinGeo, glassMat);
    cabin.position.set(0, 0.47, -0.12);
    cabin.castShadow = true;
    this.tilt.add(cabin);

    // --- Cream stripe over the nose ---
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.9), creamMat);
    stripe.position.set(0, 0.44, 0.12);
    this.tilt.add(stripe);

    // --- Rear spoiler on two struts ---
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.045, 0.26), darkMat);
    spoiler.position.set(0, 0.52, -0.68);
    spoiler.castShadow = true;
    this.tilt.add(spoiler);
    for (const sx of [-0.32, 0.32]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.1), darkMat);
      strut.position.set(sx, 0.43, -0.68);
      this.tilt.add(strut);
    }

    // --- Headlights (warm, slightly emissive) ---
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xfff3d6,
      emissive: 0xffdf9e,
      emissiveIntensity: 0.55,
      roughness: 0.3,
    });
    for (const sx of [-0.3, 0.3]) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.07, 0.06), headMat);
      light.position.set(sx, 0.33, 0.74);
      this.tilt.add(light);
    }

    // --- Taillights ---
    const tailMat = new THREE.MeshStandardMaterial({
      color: 0xc22a1c,
      emissive: 0xa01a10,
      emissiveIntensity: 0.5,
      roughness: 0.4,
    });
    for (const sx of [-0.34, 0.34]) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.05), tailMat);
      light.position.set(sx, 0.34, -0.74);
      this.tilt.add(light);
    }
  }

  private buildWheels(): void {
    const tireGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.17, 18);
    tireGeo.rotateZ(Math.PI / 2); // axle along X
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.9 });
    const hubGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.185, 12);
    hubGeo.rotateZ(Math.PI / 2);
    const hubMat = new THREE.MeshStandardMaterial({
      color: 0xd8d3c8,
      roughness: 0.35,
      metalness: 0.65,
    });

    for (const [sx, sz] of [
      [-0.5, 0.48],
      [0.5, 0.48],
      [-0.5, -0.48],
      [0.5, -0.48],
    ] as const) {
      const wheel = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      const hub = new THREE.Mesh(hubGeo, hubMat);
      wheel.add(tire, hub);
      wheel.position.set(sx, WHEEL_RADIUS, sz);
      this.tilt.add(wheel);
      this.wheels.push(wheel);
    }
  }

  update(u: CarUpdate): void {
    this.group.position.set(u.x, 0, u.z);
    this.group.rotation.y = u.heading;

    // Wheels spin with the road speed.
    if (u.moving > 0) {
      this.spin += (8 * u.dt * u.moving) / WHEEL_RADIUS;
    }
    for (const wheel of this.wheels) {
      wheel.rotation.x = this.spin;
    }

    // Cosmetic yaw lag and body lean while steering — presentation only,
    // never fed back into the simulation.
    const targetYaw = u.steering ? -0.13 : 0;
    const targetLean = u.steering ? 0.07 : 0;
    const rate = u.reducedMotion ? 14 : 6;
    this.driftYaw += (targetYaw - this.driftYaw) * Math.min(1, rate * u.dt);
    this.lean += (targetLean - this.lean) * Math.min(1, rate * u.dt);
    this.tilt.rotation.y = this.driftYaw;
    this.tilt.rotation.z = this.lean;
    // Slight suspension bob while steering.
    this.tilt.position.y = u.steering ? 0.012 : 0;
  }
}
