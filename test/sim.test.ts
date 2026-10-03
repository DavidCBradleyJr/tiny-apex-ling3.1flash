/**
 * Simulation tests: the fixed-step state machine, the one-button
 * driving contract (a correctly timed hold/release sequence must
 * complete laps; mistimed ones must crash), checkpoint ordering,
 * crash boundary consistency, pause/resume and reset behavior.
 *
 * The "tolerant driver" below steers one unit early into each
 * corner, driven by the car's nearest centerline coordinate.
 * Because an early-turn circle has the same radius as the track
 * arc, the car cuts each corner slightly and its centerline
 * coordinate runs up to 2 units ahead of its odometer — the
 * hold windows below are expressed in centerline coordinates
 * and account for that.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ARC,
  distanceToCenterline,
  headingAt,
  NUM_CHECKPOINTS,
  pointAt,
  RADIUS,
  ROAD_HALF,
  STRAIGHT,
  TOTAL_LENGTH,
} from '../src/track.js';
import {
  CAR_RADIUS,
  CAR_SPEED,
  CRASH_DISTANCE,
  gates,
  initialState,
  pause,
  reset,
  resume,
  SIM_STEP,
  startRun,
  STEER_RATE,
  step,
  perfectSteering,
} from '../src/sim.js';
import type { SimState } from '../src/sim.js';

/** Run the sim for `seconds` of sim time with a steering schedule. */
function drive(
  sim: SimState,
  seconds: number,
  steeringAt: (t: number) => boolean,
): void {
  let t = 0;
  while (t < seconds && sim.state === 'racing') {
    step(sim, SIM_STEP, steeringAt(t));
    t += SIM_STEP;
  }
}

test('turning radius matches the track corner radius', () => {
  const turningRadius = CAR_SPEED / STEER_RATE;
  assert.ok(Math.abs(turningRadius - RADIUS) < 1e-9);
  assert.equal(CAR_SPEED, 8);
  assert.equal(STEER_RATE, 1);
  assert.ok(Math.abs(CRASH_DISTANCE - (ROAD_HALF - CAR_RADIUS)) < 1e-9);
  assert.ok(CRASH_DISTANCE > 0, 'a sane crash band exists inside the road');
});

test('initial state and reset restore every run-scoped value', () => {
  const sim = initialState();
  assert.equal(sim.state, 'ready');
  assert.equal(sim.x, 0);
  assert.equal(sim.z, 0);
  assert.equal(sim.heading, 0);
  assert.equal(sim.steering, false);
  assert.equal(sim.points, 0);
  assert.equal(sim.laps, 0);
  assert.equal(sim.nextCheckpoint, 1);
  assert.equal(sim.time, 0);
  assert.equal(sim.crash, null);

  // Dirty it, then reset.
  sim.state = 'crashed';
  sim.x = 12;
  sim.z = -3;
  sim.heading = 2;
  sim.steering = true;
  sim.points = 7;
  sim.laps = 1;
  sim.nextCheckpoint = 5;
  sim.time = 99;
  sim.crash = { x: 12, z: -3 };
  reset(sim);
  assert.deepEqual(sim, initialState());
});

test('startRun resets and enters racing; pause/resume only transition valid pairs', () => {
  const sim = initialState();
  startRun(sim);
  assert.equal(sim.state, 'racing');
  assert.equal(sim.points, 0);

  pause(sim);
  assert.equal(sim.state, 'paused');
  // Paused: no movement, no time.
  const x0 = sim.x;
  const z0 = sim.z;
  drive(sim, 2, () => true);
  assert.equal(sim.x, x0);
  assert.equal(sim.z, z0);
  assert.equal(sim.time, 0);

  resume(sim);
  assert.equal(sim.state, 'racing');
  drive(sim, 0.5, () => false);
  assert.ok(sim.time > 0);
  assert.ok(Math.abs(sim.z - CAR_SPEED * 0.5) < 1e-9);

  // Invalid transitions are ignored.
  const sim2 = initialState();
  resume(sim2); // ready -> stays ready
  assert.equal(sim2.state, 'ready');
  pause(sim2); // ready -> stays ready
  assert.equal(sim2.state, 'ready');
});

test('never steering: the car passes gate 1, then runs off the end of straight 1', () => {
  const sim = initialState();
  startRun(sim);
  drive(sim, 8, () => false);
  assert.equal(sim.state, 'crashed');
  assert.ok(sim.crash !== null);
  // Legitimately crossed gate 1 on the way out...
  assert.equal(sim.points, 1);
  assert.equal(sim.nextCheckpoint, 2);
  // ...then crashed past the end of straight 1, still on x = 0,
  // where the straight's endpoint is the nearest centerline point.
  assert.ok(Math.abs(sim.crash.x) < 0.2);
  assert.ok(sim.crash.z > 17 && sim.crash.z < 19.5);
  assert.equal(sim.laps, 0);
});

test('always steering: the car spirals off the road immediately', () => {
  const sim = initialState();
  startRun(sim);
  drive(sim, 8, () => true);
  assert.equal(sim.state, 'crashed');
  assert.ok(sim.crash !== null);
  // The turning circle leaves straight 1's outer edge almost
  // immediately: crash happens in the first quarter of the loop.
  assert.ok(sim.crash.x > -2 && sim.crash.x < -1);
  assert.ok(sim.crash.z > 4 && sim.crash.z < 5);
  assert.equal(sim.points, 0);
});

test('a correctly timed hold/release sequence completes two full laps', () => {
  const sim = initialState();
  startRun(sim);
  const lapTime = TOTAL_LENGTH / CAR_SPEED;
  drive(sim, lapTime * 2, (t) => perfectSteering(t));
  assert.equal(sim.state, 'racing', 'the perfect driver must not crash');
  assert.equal(sim.points, 2 * NUM_CHECKPOINTS);
  assert.equal(sim.laps, 2);
  assert.equal(sim.nextCheckpoint, 1);
  // Back at the start line after two full laps.
  assert.ok(Math.abs(sim.x) < 0.5);
  assert.ok(Math.abs(sim.z) < 0.5);
});

test('a slightly late line (turning one unit past each corner entry) also laps', () => {
  const sim = initialState();
  startRun(sim);
  // Hold windows in centerline coordinates. The car turns
  // `delta` units past each corner entry; its turning circle
  // (same radius as the track) is offset `delta` from the
  // corner center, so it stays within `delta` of the
  // centerline — inside the 1.35 crash band — and rejoins
  // the centerline exactly at the far end of the corner.
  //
  // The nearest-centerline coordinate at circle completion
  // lags the arc end by R*atan(delta/R) (the circle is
  // offset from the corner center), which the window end
  // accounts for. Window 2 needs no upper bound: it ends
  // when the coordinate wraps past the start/finish line.
  const delta = 0.95;
  const lag = RADIUS * Math.atan2(delta, RADIUS);
  const win1Start = STRAIGHT + delta;
  const win1End = STRAIGHT + ARC - lag;
  const win2Start = 2 * STRAIGHT + ARC + delta;
  const win2End = 2 * STRAIGHT + 2 * ARC - lag;
  drive(sim, 21.5, () => {
    const s = centerlineCoordinate(sim.x, sim.z);
    return (s >= win1Start && s < win1End) || (s >= win2Start && s < win2End);
  });
  assert.equal(sim.state, 'racing', 'the late driver must not crash');
  assert.equal(sim.points, 2 * NUM_CHECKPOINTS);
  assert.equal(sim.laps, 2);
});

test('holding 0.2s too long through turn 1 crashes on straight 2', () => {
  const sim = initialState();
  startRun(sim);
  const lapTime = TOTAL_LENGTH / CAR_SPEED;
  drive(sim, lapTime, (t) => {
    const turn1Start = STRAIGHT / CAR_SPEED;
    const turn1End = turn1Start + ARC / CAR_SPEED;
    return t >= turn1Start && t < turn1End + 0.2; // 0.2s over-hold
  });
  assert.equal(sim.state, 'crashed');
  assert.ok(sim.crash !== null);
  // Drifts past the outer edge of straight 2.
  assert.ok(sim.crash.x > -16 && sim.crash.x < -14);
  assert.ok(sim.crash.z > 0 && sim.crash.z < STRAIGHT);
});

test('releasing 0.2s too early through turn 1 crashes on straight 2', () => {
  const sim = initialState();
  startRun(sim);
  const lapTime = TOTAL_LENGTH / CAR_SPEED;
  drive(sim, lapTime, (t) => {
    const turn1Start = STRAIGHT / CAR_SPEED;
    const turn1End = turn1Start + ARC / CAR_SPEED;
    return t >= turn1Start && t < turn1End - 0.2; // 0.2s under-hold
  });
  assert.equal(sim.state, 'crashed');
  assert.ok(sim.crash !== null);
  // Drifts past the inner edge of straight 2.
  assert.ok(sim.crash.x < -16 && sim.crash.x > -18);
  assert.ok(sim.crash.z > 0 && sim.crash.z < STRAIGHT);
});

test('gates must be crossed in order; an early gate 1 crossing scores nothing', () => {
  const sim = initialState();
  sim.state = 'racing';
  sim.nextCheckpoint = 3; // gate 1 is not the next one
  placeAtGate(sim, 1, 0.5); // just before gate 1, heading through it
  drive(sim, 1, () => false);
  assert.equal(sim.points, 0);
  assert.equal(sim.nextCheckpoint, 3);
  assert.equal(sim.state, 'racing');
});

test('backwards gate crossings never score', () => {
  const sim = initialState();
  sim.state = 'racing';
  placeAtGate(sim, 1, -0.5); // just past gate 1
  sim.heading += Math.PI; // reverse: cross the gate backwards
  drive(sim, 0.5, () => false);
  assert.equal(sim.points, 0);
  assert.equal(sim.nextCheckpoint, 1);
  assert.equal(sim.state, 'racing', 'on-centerline driving never crashes');
});

test('crossing the finish line before checkpoint 8 is due scores nothing', () => {
  const sim = initialState();
  sim.state = 'racing';
  sim.nextCheckpoint = 1;
  // Near the end of turn 2, just before the start/finish line.
  const s = TOTAL_LENGTH - 0.5;
  const p = pointAt(s);
  sim.x = p.x;
  sim.z = p.z;
  sim.heading = headingAt(s);
  drive(sim, 0.5, () => false);
  assert.equal(sim.points, 0);
  assert.equal(sim.nextCheckpoint, 1);
  assert.equal(sim.state, 'racing');
});

test('a valid crossing scores exactly one point and advances the next checkpoint', () => {
  const sim = initialState();
  sim.state = 'racing';
  placeAtGate(sim, 1, 0.5);
  drive(sim, 0.5, () => false);
  assert.equal(sim.points, 1);
  assert.equal(sim.nextCheckpoint, 2);
  assert.equal(sim.state, 'racing');
});

test('the last checkpoint is gate 8 and completing it increments the lap', () => {
  const sim = initialState();
  sim.state = 'racing';
  sim.nextCheckpoint = NUM_CHECKPOINTS;
  placeAtGate(sim, NUM_CHECKPOINTS, 0.5);
  drive(sim, 0.5, () => false);
  assert.equal(sim.points, 1);
  assert.equal(sim.laps, 1);
  assert.equal(sim.nextCheckpoint, 1, 'checkpoint sequence wraps');
});

test('crossings near the road edge still score while on the road', () => {
  const sim = initialState();
  sim.state = 'racing';
  placeAtGate(sim, 1, 0.5, CRASH_DISTANCE - 0.05); // just inside the crash band
  drive(sim, 0.5, () => false);
  assert.equal(sim.points, 1);
  assert.equal(sim.state, 'racing');
});

test('crossings outside the crash band crash instead of scoring', () => {
  const sim = initialState();
  sim.state = 'racing';
  placeAtGate(sim, 1, 0.5, CRASH_DISTANCE + 0.05);
  drive(sim, 0.5, () => false);
  assert.equal(sim.state, 'crashed');
  assert.equal(sim.points, 0, 'an off-road crossing must not score');
  assert.equal(sim.nextCheckpoint, 1);
});

test('crash is reported at the off-road footprint center', () => {
  const sim = initialState();
  startRun(sim);
  drive(sim, 8, () => false);
  assert.equal(sim.state, 'crashed');
  assert.ok(sim.crash !== null);
  assert.ok(distanceToCenterline(sim.crash.x, sim.crash.z) > CRASH_DISTANCE);
  assert.ok(
    Math.abs(sim.crash.x - sim.x) < 1e-9 && Math.abs(sim.crash.z - sim.z) < 1e-9,
  );
});

test('fixed timestep: movement per step is speed * step', () => {
  const sim = initialState();
  sim.state = 'racing';
  step(sim, SIM_STEP, false);
  assert.ok(Math.abs(sim.z - CAR_SPEED * SIM_STEP) < 1e-12);
  assert.ok(Math.abs(sim.time - SIM_STEP) < 1e-12);
});

test('steering rotates the heading clockwise (heading decreases) at the stated rate', () => {
  const sim = initialState();
  sim.state = 'racing';
  step(sim, SIM_STEP, true);
  assert.ok(sim.heading < 0);
  assert.ok(Math.abs(sim.heading + STEER_RATE * SIM_STEP) < 1e-12);
});

test('gate table matches the track: 8 gates, gate 8 on the start line', () => {
  assert.equal(gates.length, NUM_CHECKPOINTS);
  assert.equal(gates[NUM_CHECKPOINTS - 1].cp, NUM_CHECKPOINTS);
  assert.ok(Math.abs(gates[NUM_CHECKPOINTS - 1].x) < 1e-9);
  assert.ok(Math.abs(gates[NUM_CHECKPOINTS - 1].z) < 1e-9);
});

// ---------- test helpers ----------

function placeAtGate(sim: SimState, cp: number, back: number, lateral = 0): void {
  const gate = gates[cp - 1];
  sim.x = gate.x - gate.tx * back + gate.nx * lateral;
  sim.z = gate.z - gate.tz * back + gate.nz * lateral;
  sim.heading = Math.atan2(gate.tx, gate.tz);
}

/**
 * Nearest centerline arc-length coordinate for a point that is
 * close to the centerline (test-only steering oracle).
 */
function centerlineCoordinate(x: number, z: number): number {
  const samples = 1440;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i <= samples; i++) {
    const s = (i / samples) * TOTAL_LENGTH;
    const p = pointAt(s);
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
