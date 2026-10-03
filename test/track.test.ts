/**
 * Track geometry tests: stadium dimensions, continuity, distance
 * field, and checkpoint gate placement.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ARC,
  buildGates,
  distanceToCenterline,
  headingAt,
  NUM_CHECKPOINTS,
  pointAt,
  RADIUS,
  ROAD_HALF,
  STRAIGHT,
  TOTAL_LENGTH,
  tangentAt,
  TURN1_CENTER,
  TURN2_CENTER,
  wrapDistance,
} from '../src/track.js';

const EPS = 1e-9;

test('stadium dimensions: total length is 2 straights + 2 semicircles', () => {
  assert.ok(Math.abs(TOTAL_LENGTH - (2 * STRAIGHT + 2 * Math.PI * RADIUS)) < EPS);
  assert.equal(STRAIGHT, 14);
  assert.equal(RADIUS, 8);
  assert.equal(ROAD_HALF, 2);
  assert.ok(Math.abs(ARC - Math.PI * 8) < EPS);
});

test('centerline passes through the key stadium points', () => {
  const p0 = pointAt(0);
  assert.ok(Math.abs(p0.x) < EPS && Math.abs(p0.z) < EPS, 'start at origin');

  const p1 = pointAt(STRAIGHT);
  assert.ok(Math.abs(p1.x) < EPS && Math.abs(p1.z - STRAIGHT) < EPS, 'end of straight 1');

  const p2 = pointAt(STRAIGHT + ARC);
  assert.ok(
    Math.abs(p2.x - 2 * -RADIUS) < EPS && Math.abs(p2.z - STRAIGHT) < EPS,
    'end of turn 1',
  );

  const p3 = pointAt(2 * STRAIGHT + ARC);
  assert.ok(
    Math.abs(p3.x - 2 * -RADIUS) < EPS && Math.abs(p3.z) < EPS,
    'end of straight 2',
  );

  const p4 = pointAt(TOTAL_LENGTH);
  assert.ok(Math.abs(p4.x) < EPS && Math.abs(p4.z) < EPS, 'wraps back to the start line');
});

test('corner centers are offset to the right of the straights', () => {
  assert.ok(Math.abs(TURN1_CENTER.x + RADIUS) < EPS && Math.abs(TURN1_CENTER.z - STRAIGHT) < EPS);
  assert.ok(Math.abs(TURN2_CENTER.x + RADIUS) < EPS && Math.abs(TURN2_CENTER.z) < EPS);
});

test('tangents are continuous at the straight/arc joins', () => {
  for (const s of [0, STRAIGHT, STRAIGHT + ARC, 2 * STRAIGHT + ARC, TOTAL_LENGTH - 0.001]) {
    const before = tangentAt(s - 1e-6);
    const after = tangentAt(s + 1e-6);
    const dx = before.x - after.x;
    const dz = before.z - after.z;
    assert.ok(
      Math.hypot(dx, dz) < 1e-4,
      `tangent discontinuity near s=${s.toFixed(3)}`,
    );
  }
  assert.ok(Math.abs(tangentAt(0).z - 1) < EPS, 'start heading is +Z');
  assert.ok(Math.abs(tangentAt(2 * STRAIGHT + ARC).z + 1) < EPS, 'straight 2 heads -Z');
});

test('centerline points have (near) zero distance to the centerline', () => {
  for (let i = 0; i < 400; i++) {
    const s = (i / 400) * TOTAL_LENGTH;
    const p = pointAt(s);
    assert.ok(
      distanceToCenterline(p.x, p.z) < 1e-6,
      `centerline point at s=${s.toFixed(3)} is off the centerline`,
    );
  }
});

test('distance field: road interior is inside, infield and outside are far', () => {
  // Middle of straight 1, one unit to the right of the centerline.
  assert.ok(Math.abs(distanceToCenterline(1, 7) - 1) < 1e-6);
  // Middle of the infield: far from the ring-shaped centerline.
  assert.ok(Math.abs(distanceToCenterline(-8, 7) - 8) < 1e-6);
  // Well outside the track.
  assert.ok(distanceToCenterline(30, 40) > 20);
  // Just outside the outer edge of straight 1.
  assert.ok(distanceToCenterline(3, 7) > 1.35);
  // Just inside the inner edge of straight 1.
  assert.ok(distanceToCenterline(-1.3, 7) < 1.35);
});

test('distance field is correct around the corners', () => {
  // Apex of turn 1 (on the centerline).
  const apex = pointAt(STRAIGHT + ARC / 2);
  assert.ok(distanceToCenterline(apex.x, apex.z) < 1e-6);
  // One unit inside the turn (toward the corner center).
  const mid = {
    x: apex.x + (TURN1_CENTER.x - apex.x) / RADIUS,
    z: apex.z + (TURN1_CENTER.z - apex.z) / RADIUS,
  };
  assert.ok(Math.abs(distanceToCenterline(mid.x, mid.z) - 1) < 1e-6);
  // One unit outside the turn (away from the corner center).
  const out = {
    x: apex.x + (apex.x - TURN1_CENTER.x) / RADIUS,
    z: apex.z + (apex.z - TURN1_CENTER.z) / RADIUS,
  };
  assert.ok(Math.abs(distanceToCenterline(out.x, out.z) - 1) < 1e-6);
});

test('eight gates, evenly spaced by distance, gate 8 on the start line', () => {
  const gates = buildGates();  assert.equal(gates.length, NUM_CHECKPOINTS);
  const expectedSpacing = TOTAL_LENGTH / NUM_CHECKPOINTS;
  for (let i = 0; i < gates.length; i++) {
    assert.equal(gates[i].cp, i + 1);
    const expected = wrapDistance(((i + 1) % NUM_CHECKPOINTS) * expectedSpacing);
    assert.ok(
      Math.abs(gates[i].s - expected) < 1e-9,
      `gate ${i + 1} is not evenly spaced`,
    );
  }
  const finish = gates[NUM_CHECKPOINTS - 1];
  assert.ok(Math.abs(finish.s) < 1e-9, 'checkpoint 8 sits on the start/finish line');
  assert.ok(Math.abs(finish.x) < 1e-9 && Math.abs(finish.z) < 1e-9);
});

test('gates span the road width and cross the centerline at right angles', () => {
  for (const gate of buildGates()) {
    // Tangent and normal are perpendicular unit vectors.
    assert.ok(Math.abs(gate.tx * gate.nx + gate.tz * gate.nz) < 1e-9);
    assert.ok(Math.abs(gate.tx ** 2 + gate.tz ** 2 - 1) < 1e-9);
    assert.ok(Math.abs(gate.nx ** 2 + gate.nz ** 2 - 1) < 1e-9);
    // Gate center is on the centerline.
    assert.ok(distanceToCenterline(gate.x, gate.z) < 1e-6);
    // Gate ends sit on the road edges.
    for (const side of [-1, 1]) {
      const ex = gate.x + gate.nx * side * ROAD_HALF;
      const ez = gate.z + gate.nz * side * ROAD_HALF;
      assert.ok(
        Math.abs(distanceToCenterline(ex, ez) - ROAD_HALF) < 1e-6,
        `gate ${gate.cp} end is not on the road edge`,
      );
    }
  }
});

test('heading angle matches the tangent direction', () => {
  for (const s of [0, 5, STRAIGHT, STRAIGHT + 2, 2 * STRAIGHT + ARC, TOTAL_LENGTH - 3]) {
    const t = tangentAt(s);
    const h = headingAt(s);
    assert.ok(Math.abs(Math.sin(h) - t.x) < 1e-9);
    assert.ok(Math.abs(Math.cos(h) - t.z) < 1e-9);
  }
});
