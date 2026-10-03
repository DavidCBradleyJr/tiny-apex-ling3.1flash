/**
 * Tiny Apex — simulation state machine (pure logic, no rendering).
 *
 * Arcade steering contract:
 *   - The car drives forward at a constant CAR_SPEED while racing.
 *   - While steering is held, heading changes by STEER_RATE radians per
 *     second clockwise (as seen from above); released, it drives straight.
 *   - The turning radius (SPEED / STEER_RATE = 8) matches the track's
 *     corner radius, so a correctly timed hold/release sequence completes
 *     laps. Steering is presentation-only: it never alters the collision
 *     footprint or the rules.
 *   - Crash when the car's circular footprint (radius CAR_RADIUS) extends
 *     beyond the road, on either the inner or the outer edge.
 *   - One point per checkpoint passed in order through its gate; checkpoint
 *     8 is the start/finish line and completing it also increments the lap
 *     count. Survival, revisits and backwards or off-road crossings score
 *     nothing.
 */

import {
  ARC,
  buildGates,
  distanceToCenterline,
  NUM_CHECKPOINTS,
  ROAD_HALF,
  STRAIGHT,
} from './track.js';
import type { Gate } from './track.js';

/** Forward speed in world units per second. */
export const CAR_SPEED = 8;
/** Steering rate in radians per second while held (clockwise from above). */
export const STEER_RATE = 1;
/** Radius of the car's circular collision footprint. */
export const CAR_RADIUS = 0.65;
/** Crash once the footprint center is further than this from the centerline. */
export const CRASH_DISTANCE = ROAD_HALF - CAR_RADIUS;
/** Fixed simulation timestep in seconds. */
export const SIM_STEP = 1 / 120;

export type GameState = 'ready' | 'racing' | 'paused' | 'crashed';

export interface CrashInfo {
  x: number;
  z: number;
}

export interface SimState {
  state: GameState;
  /** Position of the footprint center on the flat XZ plane. */
  x: number;
  z: number;
  /** Heading angle: direction of travel is (sin heading, cos heading). */
  heading: number;
  /** Whether steering is currently held (mirror of the input state). */
  steering: boolean;
  points: number;
  laps: number;
  /** Next checkpoint that will score, 1..8. */
  nextCheckpoint: number;
  /** Simulation clock; only advances while racing. */
  time: number;
  crash: CrashInfo | null;
}

/** Gates are static track data, built once. */
export const gates: Gate[] = buildGates();

export function initialState(): SimState {
  return {
    state: 'ready',
    x: 0,
    z: 0,
    heading: 0,
    steering: false,
    points: 0,
    laps: 0,
    nextCheckpoint: 1,
    time: 0,
    crash: null,
  };
}

/** Restore every run-scoped value to the initial state. */
export function reset(sim: SimState): void {
  const fresh = initialState();
  Object.assign(sim, fresh);
}

/** Reset and begin a new run. */
export function startRun(sim: SimState): void {
  reset(sim);
  sim.state = 'racing';
}

/** Pause a running race. Clears held steering. */
export function pause(sim: SimState): void {
  if (sim.state === 'racing') {
    sim.state = 'paused';
    sim.steering = false;
  }
}

/** Resume a paused race. The caller must also reset the frame clock. */
export function resume(sim: SimState): void {
  if (sim.state === 'paused') {
    sim.state = 'racing';
  }
}

/**
 * Advance the simulation by one fixed step while racing.
 * Returns true when the car crossed the next checkpoint's gate this step.
 */
export function step(sim: SimState, dt: number, steering: boolean): boolean {
  if (sim.state !== 'racing') {
    return false;
  }
  sim.steering = steering;

  const prevX = sim.x;
  const prevZ = sim.z;

  if (steering) {
    sim.heading -= STEER_RATE * dt;
  }
  sim.x += Math.sin(sim.heading) * CAR_SPEED * dt;
  sim.z += Math.cos(sim.heading) * CAR_SPEED * dt;
  sim.time += dt;

  // Crash check first: an off-road crossing is a crash, not a score.
  if (distanceToCenterline(sim.x, sim.z) > CRASH_DISTANCE) {
    sim.state = 'crashed';
    sim.crash = { x: sim.x, z: sim.z };
    sim.steering = false;
    return false;
  }

  // Checkpoint: did the car cross the *next* gate in the forward direction?
  const gate = gates[sim.nextCheckpoint - 1];
  const d0 = (prevX - gate.x) * gate.tx + (prevZ - gate.z) * gate.tz;
  const d1 = (sim.x - gate.x) * gate.tx + (sim.z - gate.z) * gate.tz;
  if (d0 < 0 && d1 >= 0) {
    const t = d0 / (d0 - d1);
    const ix = prevX + (sim.x - prevX) * t;
    const iz = prevZ + (sim.z - prevZ) * t;
    const u = (ix - gate.x) * gate.nx + (iz - gate.z) * gate.nz;
    if (Math.abs(u) <= ROAD_HALF) {
      sim.points += 1;
      if (sim.nextCheckpoint === NUM_CHECKPOINTS) {
        sim.laps += 1;
        sim.nextCheckpoint = 1;
      } else {
        sim.nextCheckpoint += 1;
      }
      return true;
    }
  }
  return false;
}

/**
 * The lap-proficient steering schedule, expressed in simulation time:
 * hold through each corner, release on each straight. Useful for tests
 * and for sanity-checking the mechanics.
 */
export function perfectSteering(timeSeconds: number): boolean {
  const lapTime = (2 * STRAIGHT + 2 * ARC) / CAR_SPEED;
  const t = ((timeSeconds % lapTime) + lapTime) % lapTime;
  const turn1Start = STRAIGHT / CAR_SPEED;
  const turn1End = turn1Start + ARC / CAR_SPEED;
  const turn2Start = turn1End + STRAIGHT / CAR_SPEED;
  const turn2End = turn2Start + ARC / CAR_SPEED;
  return (t >= turn1Start && t < turn1End) || (t >= turn2Start && t < turn2End);
}
