/**
 * Tiny Apex — the whole miniature desert circuit, authored in code:
 * sculpted raised base, asphalt with cream markings, alternating curbs,
 * start/finish checker, checkpoint gates, and hand-built scenery
 * (rocks, cacti, signs, a grandstand, a flag pole). No external assets.
 *
 * Also owns the warm lighting rig and the orthographic camera with
 * viewport fitting (the world is never stretched to fit a screen).
 */

import * as THREE from 'three';
import {
  distanceToCenterline,
  headingAt,
  pointAt,
  ROAD_HALF,
  TOTAL_LENGTH,
  tangentAt,
} from './track.js';
import { buildGates } from './track.js';

const MARGIN = 1.12;

/** Deterministic PRNG so scenery layout is stable between runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundedRectShape(
  cx: number,
  cz: number,
  hx: number,
  hz: number,
  r: number,
): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(cx - hx + r, cz - hz);
  s.lineTo(cx + hx - r, cz - hz);
  s.quadraticCurveTo(cx + hx, cz - hz, cx + hx, cz - hz + r);
  s.lineTo(cx + hx, cz + hz - r);
  s.quadraticCurveTo(cx + hx, cz + hz, cx + hx - r, cz + hz);
  s.lineTo(cx - hx + r, cz + hz);
  s.quadraticCurveTo(cx - hx, cz + hz, cx - hx, cz + hz - r);
  s.lineTo(cx - hx, cz - hz + r);
  s.quadraticCurveTo(cx - hx, cz - hz, cx - hx + r, cz - hz);
  return s;
}

/** Extrude a flat shape into a horizontal slab whose top sits at `topY`. */
function extrudeSlab(shape: THREE.Shape, depth: number, topY: number): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.18,
    bevelSize: 0.18,
    bevelSegments: 2,
    curveSegments: 12,
  });
  geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo);
  mesh.position.y = topY;
  return mesh;
}

function noiseTexture(
  base: string,
  fleck: string,
  size = 256,
  flecks = 1100,
  alphaMax = 0.14,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < flecks; i++) {
    ctx.fillStyle = fleck;
    ctx.globalAlpha = 0.04 + Math.random() * alphaMax;
    const s = 1 + Math.random() * 2.6;
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function textTexture(lines: string[], opts: { bg: string; fg: string; accent?: string }): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = opts.bg;
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = opts.fg;
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, 484, 228);
  ctx.fillStyle = opts.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = lines.length > 1 ? 64 : 84;
  ctx.font = `800 ${size}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  const step = size * 1.15;
  const startY = 128 - ((lines.length - 1) * step) / 2;
  lines.forEach((line, i) => ctx.fillText(line, 256, startY + i * step));
  if (opts.accent) {
    ctx.fillStyle = opts.accent;
    ctx.fillRect(96, 208, 320, 14);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function checkerTexture(cells = 8): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const cell = 128 / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#26262b' : '#f5e9cf';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface WorldHandle {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  fitView(width: number, height: number): void;
  setNextCheckpoint(cp: number): void;
  showCrashMarker(x: number, z: number): void;
  hideCrashMarker(): void;
  update(dt: number): void;
}

export function buildWorld(): WorldHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf3e3c8);

  // ---------- Camera: restrained orthographic, elevated three-quarter ----------
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
  const target = new THREE.Vector3(-8, 0, 7);
  const camDir = new THREE.Vector3(0.42, 0.78, -0.62).normalize();
  camera.position.copy(target).addScaledVector(camDir, 120);
  camera.lookAt(target);

  // ---------- Lighting: warm key light + sky/ground fill ----------
  const hemi = new THREE.HemisphereLight(0xcde7ff, 0xe0b98a, 0.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffdfb0, 2.4);
  sun.position.set(target.x + 30, 55, target.z - 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -36;
  sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 36;
  sun.shadow.camera.bottom = -36;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 140;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);
  sun.target.position.copy(target);

  const fill = new THREE.DirectionalLight(0xbfd9e8, 0.35);
  fill.position.set(target.x - 25, 30, target.z + 28);
  scene.add(fill);

  const world = new THREE.Group();
  scene.add(world);

  // Track gates are static track data, built once.
  const trackGates = buildGates();

  // ---------- Ground plane (the "table" the miniature sits on) ----------
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(240, 48),
    new THREE.MeshStandardMaterial({ color: 0xdfc193, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -3.95;
  ground.receiveShadow = true;
  scene.add(ground);

  // ---------- Sculpted raised base: sand slab on a terracotta plinth ----------
  const sandMat = new THREE.MeshStandardMaterial({
    map: noiseTexture('#e6c184', '#c9a05e', 256, 900, 0.1),
    roughness: 0.96,
  });
  const sandSlab = extrudeSlab(roundedRectShape(-8, 7, 17, 21, 4.5), 2.2, 0);
  sandSlab.material = sandMat;
  sandSlab.receiveShadow = true;
  sandSlab.castShadow = true;
  world.add(sandSlab);

  const plinthMat = new THREE.MeshStandardMaterial({ color: 0xb85c38, roughness: 0.85 });
  const plinth = extrudeSlab(roundedRectShape(-8, 7, 18.4, 22.4, 5.4), 1.6, -2.2);
  plinth.material = plinthMat;
  plinth.castShadow = true;
  world.add(plinth);

  // ---------- Road: dark asphalt strip along the centerline ----------
  const roadGroup = new THREE.Group();
  world.add(roadGroup);

  const asphaltTex = noiseTexture('#43434b', '#2f2f36', 256, 1400, 0.2);
  asphaltTex.repeat.set(1, TOTAL_LENGTH / 6);
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphaltTex,
    roughness: 0.94,
  });

  const N = 560;
  const roadPos: number[] = [];
  const roadUv: number[] = [];
  const roadNorm: number[] = [];
  const roadIdx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * TOTAL_LENGTH;
    const p = pointAt(s);
    const t = tangentAt(s);
    const nx = t.z;
    const nz = -t.x;
    roadPos.push(p.x + nx * ROAD_HALF, 0.015, p.z + nz * ROAD_HALF);
    roadPos.push(p.x - nx * ROAD_HALF, 0.015, p.z - nz * ROAD_HALF);
    const v = s / 6;
    roadUv.push(0, v, 1, v);
    roadNorm.push(0, 1, 0, 0, 1, 0);
    if (i < N) {
      const a = 2 * i;
      roadIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPos, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUv, 2));
  roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(roadNorm, 3));
  roadGeo.setIndex(roadIdx);
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = true;
  roadGroup.add(road);

  // ---------- Cream edge lines ----------
  const creamMat = new THREE.MeshStandardMaterial({ color: 0xf5e9cf, roughness: 0.7 });
  for (const side of [-1, 1]) {
    const pos: number[] = [];
    const idx: number[] = [];
    const norm: number[] = [];
    for (let i = 0; i <= N; i++) {
      const s = (i / N) * TOTAL_LENGTH;
      const p = pointAt(s);
      const t = tangentAt(s);
      const nx = t.z * side;
      const nz = -t.x * side;
      const a = ROAD_HALF - 0.14;
      const b = ROAD_HALF - 0.04;
      pos.push(p.x + nx * a, 0.022, p.z + nz * a);
      pos.push(p.x + nx * b, 0.022, p.z + nz * b);
      norm.push(0, 1, 0, 0, 1, 0);
      if (i < N) {
        const k = 2 * i;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    geo.setIndex(idx);
    const line = new THREE.Mesh(geo, creamMat);
    line.receiveShadow = true;
    roadGroup.add(line);
  }

  // ---------- Cream center dashes ----------
  const dashCount = Math.floor(TOTAL_LENGTH / 1.4);
  const dashGeo = new THREE.BoxGeometry(0.14, 0.012, 0.55);
  const dashes = new THREE.InstancedMesh(dashGeo, creamMat, dashCount);
  const dashMatrix = new THREE.Matrix4();
  const dashQuat = new THREE.Quaternion();
  const dashScale = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < dashCount; i++) {
    const s = i * 1.4 + 0.7;
    const p = pointAt(s);
    dashQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingAt(s));
    dashMatrix.compose(new THREE.Vector3(p.x, 0.026, p.z), dashQuat, dashScale);
    dashes.setMatrixAt(i, dashMatrix);
  }
  dashes.receiveShadow = true;
  roadGroup.add(dashes);

  // ---------- Alternating curbs on both edges ----------
  const curbSpacing = 1.55;
  const curbCountPerEdge = Math.floor(TOTAL_LENGTH / curbSpacing);
  const curbGeo = new THREE.BoxGeometry(0.42, 0.05, curbSpacing * 0.96);
  const curbMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const curbs = new THREE.InstancedMesh(curbGeo, curbMat, curbCountPerEdge * 2);
  const curbColor = new THREE.Color();
  for (let i = 0; i < curbCountPerEdge; i++) {
    const s = i * curbSpacing + curbSpacing / 2;
    const p = pointAt(s);
    dashQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingAt(s));
    const color = i % 2 === 0 ? 0xc05b3c : 0xf3e6c8;
    curbColor.setHex(color);
    for (let e = 0; e < 2; e++) {
      const side = e === 0 ? 1 : -1;
      const nx = tangentAt(s).z * side;
      const nz = -tangentAt(s).x * side;
      const inst = i * 2 + e;
      dashMatrix.compose(
        new THREE.Vector3(p.x + nx * (ROAD_HALF + 0.21), 0.025, p.z + nz * (ROAD_HALF + 0.21)),
        dashQuat,
        dashScale,
      );
      curbs.setMatrixAt(inst, dashMatrix);
      curbs.setColorAt(inst, curbColor);
    }
  }
  curbs.instanceColor!.needsUpdate = true;
  curbs.castShadow = true;
  curbs.receiveShadow = true;
  roadGroup.add(curbs);

  // ---------- Start / finish checker ----------
  const checkerTex = checkerTexture(8);
  const checkerMat = new THREE.MeshStandardMaterial({ map: checkerTex, roughness: 0.7 });
  const startP = pointAt(0);
  const startT = tangentAt(0);
  const startN = { x: startT.z, z: -startT.x };
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      const u = (col - 1.5) * 1.0; // across the road
      const v = (row - 0.5) * 1.0; // along the centerline
      const square = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 0.012, 1.0),
        checkerMat,
      );
      square.position.set(
        startP.x + startN.x * u + startT.x * v,
        0.03,
        startP.z + startN.z * u + startT.z * v,
      );
      square.rotation.y = headingAt(0);
      square.receiveShadow = true;
      roadGroup.add(square);
    }
  }

  // ---------- Checkpoint gates: edge posts + a floating beacon ----------
  const idlePostMat = new THREE.MeshStandardMaterial({ color: 0x8d7c66, roughness: 0.7 });
  const nextPostMat = new THREE.MeshStandardMaterial({
    color: 0x1f8a8a,
    emissive: 0x1f8a8a,
    emissiveIntensity: 0.45,
    roughness: 0.4,
  });
  const postGeo = new THREE.CylinderGeometry(0.09, 0.11, 1.0, 10);
  const gatePosts: Array<[THREE.Mesh, THREE.Mesh]> = [];
  for (const gate of trackGates) {
    const pair: [THREE.Mesh, THREE.Mesh] = [null as unknown as THREE.Mesh, null as unknown as THREE.Mesh];
    for (let e = 0; e < 2; e++) {
      const side = e === 0 ? 1 : -1;
      const post = new THREE.Mesh(postGeo, idlePostMat);
      post.position.set(
        gate.x + gate.nx * side * (ROAD_HALF + 0.38),
        0.5,
        gate.z + gate.nz * side * (ROAD_HALF + 0.38),
      );
      post.castShadow = true;
      world.add(post);
      pair[e] = post;
    }
    gatePosts.push(pair);
  }

  const beacon = new THREE.Group();
  const beaconRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.055, 12, 32),
    new THREE.MeshStandardMaterial({
      color: 0x2ec4c4,
      emissive: 0x2ec4c4,
      emissiveIntensity: 0.7,
      roughness: 0.3,
    }),
  );
  beaconRing.rotation.x = Math.PI / 2;
  const beaconPillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 2.0, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x2ec4c4,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  beaconPillar.position.y = -0.9;
  beacon.add(beaconRing, beaconPillar);
  world.add(beacon);

  function setNextCheckpoint(cp: number): void {
    const gate = trackGates[cp - 1];
    beacon.position.set(gate.x, 2.15, gate.z);
    for (let i = 0; i < gatePosts.length; i++) {
      const mat = i + 1 === cp ? nextPostMat : idlePostMat;
      gatePosts[i][0].material = mat;
      gatePosts[i][1].material = mat;
    }
  }

  // ---------- Crash marker: red ring + cross, pulsing ----------
  const crashMarker = new THREE.Group();
  const crashMat = new THREE.MeshStandardMaterial({
    color: 0xe03a24,
    emissive: 0xe03a24,
    emissiveIntensity: 0.5,
    roughness: 0.5,
  });
  const crashRing = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 32), crashMat);
  crashRing.rotation.x = -Math.PI / 2;
  const barGeo = new THREE.BoxGeometry(1.15, 0.05, 0.13);
  const bar1 = new THREE.Mesh(barGeo, crashMat);
  bar1.position.y = 0.03;
  const bar2 = new THREE.Mesh(barGeo, crashMat);
  bar2.position.y = 0.03;
  bar2.rotation.y = Math.PI / 2;
  crashMarker.add(crashRing, bar1, bar2);
  crashMarker.visible = false;
  world.add(crashMarker);

  function showCrashMarker(x: number, z: number): void {
    crashMarker.position.set(x, 0.05, z);
    crashMarker.visible = true;
  }
  function hideCrashMarker(): void {
    crashMarker.visible = false;
  }

  // ---------- Scenery (deterministic layout, all clear of the road) ----------
  const rng = mulberry32(20240601);
  const reserved: Array<{ x: number; z: number; r: number }> = [
    // grandstand zone on the outside of straight 1
    { x: 4.6, z: 8, r: 4.6 },
    // signs
    { x: -16.5, z: 22.5, r: 2.4 },
    { x: 3.4, z: 15.4, r: 1.6 },
    { x: -19.4, z: -1.4, r: 1.6 },
    // flag pole near the start line
    { x: 2.7, z: -1.8, r: 1.4 },
  ];
  const baseBounds = { hx: 15.4, hz: 19.4, cx: -8, cz: 7 };

  function scatterSpot(minRoadDist: number, radius: number): { x: number; z: number } | null {
    for (let tries = 0; tries < 60; tries++) {
      const x = baseBounds.cx + (rng() * 2 - 1) * baseBounds.hx;
      const z = baseBounds.cz + (rng() * 2 - 1) * baseBounds.hz;
      if (distanceToCenterline(x, z) < minRoadDist) continue;
      if (reserved.some((r) => Math.hypot(x - r.x, z - r.z) < r.r + radius)) continue;
      return { x, z };
    }
    return null;
  }

  // Rocks
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockPalette = [0x9c8b78, 0x8a7965, 0x7a6a58, 0xa89880];
  for (let i = 0; i < 15; i++) {
    const spot = scatterSpot(3.4, 1.2);
    if (!spot) continue;
    const rock = new THREE.Mesh(
      rockGeo,
      new THREE.MeshStandardMaterial({
        color: rockPalette[Math.floor(rng() * rockPalette.length)],
        flatShading: true,
        roughness: 0.95,
      }),
    );
    const s = 0.3 + rng() * 0.75;
    rock.scale.set(s * (0.8 + rng() * 0.5), s * (0.55 + rng() * 0.5), s * (0.8 + rng() * 0.5));
    rock.position.set(spot.x, rock.scale.y * 0.55, spot.z);
    rock.rotation.y = rng() * Math.PI * 2;
    rock.castShadow = true;
    rock.receiveShadow = true;
    world.add(rock);
  }

  // Cacti
  const cactusMat = new THREE.MeshStandardMaterial({ color: 0x5e8c4f, roughness: 0.85, flatShading: true });
  for (let i = 0; i < 7; i++) {
    const spot = scatterSpot(4.1, 1.0);
    if (!spot) continue;
    const cactus = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 1.15, 9), cactusMat);
    trunk.position.y = 0.575;
    trunk.castShadow = true;
    cactus.add(trunk);
    const armHGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.42, 8);
    const armVGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.62, 8);
    for (const side of [-1, 1]) {
      if (rng() < 0.25) continue; // some cacti have one arm
      const armH = new THREE.Mesh(armHGeo, cactusMat);
      armH.rotation.z = Math.PI / 2;
      armH.position.set(side * 0.32, 0.52 + rng() * 0.25, 0);
      armH.castShadow = true;
      const armV = new THREE.Mesh(armVGeo, cactusMat);
      armV.position.set(side * 0.5, 0.52 + 0.31 + rng() * 0.25, 0);
      armV.castShadow = true;
      cactus.add(armH, armV);
    }
    cactus.position.set(spot.x, 0, spot.z);
    cactus.rotation.y = rng() * Math.PI * 2;
    world.add(cactus);
  }

  // Grandstand along the outside of straight 1
  const standGroup = new THREE.Group();
  const stepMats = [
    new THREE.MeshStandardMaterial({ color: 0xc05b3c, roughness: 0.85 }),
    new THREE.MeshStandardMaterial({ color: 0xf3e6c8, roughness: 0.85 }),
    new THREE.MeshStandardMaterial({ color: 0xc05b3c, roughness: 0.85 }),
  ];
  for (let i = 0; i < 3; i++) {
    const h = 0.35 * (i + 1);
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.1, h, 5.6), stepMats[i]);
    step.position.set(3.05 + 0.55 + i * 1.1, h / 2, 8);
    step.castShadow = true;
    step.receiveShadow = true;
    standGroup.add(step);
  }
  const crowdPalette = [0xff4b33, 0x1f8a8a, 0xf5e9cf, 0xe8a33d, 0x7a5fc0, 0x4a90d9];
  const crowdGeo = new THREE.SphereGeometry(0.1, 8, 6);
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 15; col++) {
      const fan = new THREE.Mesh(
        crowdGeo,
        new THREE.MeshStandardMaterial({ color: crowdPalette[Math.floor(rng() * crowdPalette.length)] }),
      );
      fan.position.set(3.05 + 0.55 + 2 * 1.1 + 0.25 + row * 0.32, 1.14, 5.6 + col * 0.35);
      standGroup.add(fan);
    }
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.09, 6.0), stepMats[1]);
  roof.position.set(3.05 + 0.55 + 2 * 1.1 + 0.35, 2.35, 8);
  roof.castShadow = true;
  standGroup.add(roof);
  const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.3, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x8d7c66, roughness: 0.7 });
  for (const [px, pz] of [
    [3.05, 5.2],
    [3.05, 10.8],
    [6.3, 5.2],
    [6.3, 10.8],
  ] as const) {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(px, 1.15, pz);
    standGroup.add(pole);
  }
  world.add(standGroup);

  // "TINY APEX" sign near the outside of turn 1
  const banner = new THREE.Group();
  const bannerPole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.6, 10), poleMat);
  bannerPole.position.y = 1.3;
  bannerPole.castShadow = true;
  const bannerBoard = new THREE.Mesh(
    new THREE.BoxGeometry(2.7, 1.15, 0.09),
    new THREE.MeshStandardMaterial({
      map: textTexture(['TINY', 'APEX'], { bg: '#f5e9cf', fg: '#33261a', accent: '#ff4b33' }),
      roughness: 0.6,
    }),
  );
  bannerBoard.position.y = 2.35;
  bannerBoard.castShadow = true;
  banner.add(bannerPole, bannerBoard);
  banner.position.set(-16.5, 0, 22.5);
  banner.rotation.y = Math.atan2(-8 - -16.5, 7 - 22.5);
  world.add(banner);

  // Chevron arrow signs at both corner entries
  function chevronSign(x: number, z: number, pointTx: number, pointTz: number): void {
    const sign = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.5, 8), poleMat);
    pole.position.y = 0.75;
    pole.castShadow = true;
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.62, 0.07),
      new THREE.MeshStandardMaterial({
        map: textTexture(['»'], { bg: '#f5e9cf', fg: '#33261a' }),
        roughness: 0.6,
      }),
    );
    board.position.y = 1.35;
    board.castShadow = true;
    sign.add(pole, board);
    sign.position.set(x, 0, z);
    sign.rotation.y = Math.atan2(pointTx, pointTz);
    world.add(sign);
  }
  chevronSign(3.4, 15.4, 0, 1); // before turn 1, pointing along +Z
  chevronSign(-19.4, -1.4, 0, -1); // before turn 2, pointing along -Z

  // Checkered flag pole beside the start line
  const flag = new THREE.Group();
  const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 3.0, 8), poleMat);
  flagPole.position.y = 1.5;
  flagPole.castShadow = true;
  const flagCloth = new THREE.Mesh(
    new THREE.PlaneGeometry(0.72, 0.45),
    new THREE.MeshStandardMaterial({ map: checkerTexture(6), side: THREE.DoubleSide, roughness: 0.8 }),
  );
  flagCloth.position.set(0.38, 2.7, 0);
  flag.add(flagPole, flagCloth);
  flag.position.set(2.7, 0, -1.8);
  world.add(flag);

  // ---------- Content bounds for camera fitting (excludes moving parts) ----------
  const contentBox = new THREE.Box3().setFromObject(world);

  // ---------- Public handle ----------
  let beaconPhase = 0;
  let crashPhase = 0;

  function update(dt: number): void {
    beaconPhase += dt;
    beaconRing.rotation.z = beaconPhase * 1.4;
    beaconRing.position.y = Math.sin(beaconPhase * 2.2) * 0.12;
    beaconPillar.material.opacity = 0.12 + (Math.sin(beaconPhase * 2.2) + 1) * 0.05;
    flagCloth.rotation.y = Math.sin(beaconPhase * 1.8) * 0.28;

    if (crashMarker.visible) {
      crashPhase += dt;
      const k = 1 + Math.sin(crashPhase * 5) * 0.12;
      crashMarker.scale.set(k, 1, k);
    }
  }

  function fitView(width: number, height: number): void {
    const aspect = width / height;
    camera.updateMatrixWorld();
    const v = new THREE.Vector3();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const corner of [
      [contentBox.min.x, contentBox.min.y, contentBox.min.z],
      [contentBox.max.x, contentBox.min.y, contentBox.min.z],
      [contentBox.min.x, contentBox.max.y, contentBox.min.z],
      [contentBox.max.x, contentBox.max.y, contentBox.min.z],
      [contentBox.min.x, contentBox.min.y, contentBox.max.z],
      [contentBox.max.x, contentBox.min.y, contentBox.max.z],
      [contentBox.min.x, contentBox.max.y, contentBox.max.z],
      [contentBox.max.x, contentBox.max.y, contentBox.max.z],
    ] as const) {
      v.set(corner[0], corner[1], corner[2]).applyMatrix4(camera.matrixWorldInverse);
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
    const needW = (maxX - minX) * MARGIN;
    const needH = (maxY - minY) * MARGIN;
    let halfW: number;
    let halfH: number;
    if (needW / needH > aspect) {
      halfW = needW / 2;
      halfH = halfW / aspect;
    } else {
      halfH = needH / 2;
      halfW = halfH * aspect;
    }
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
  }

  return {
    scene,
    camera,
    fitView,
    setNextCheckpoint,
    showCrashMarker,
    hideCrashMarker,
    update,
  };
}
