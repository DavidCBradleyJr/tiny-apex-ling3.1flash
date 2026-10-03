/**
 * Tiny Apex — track geometry (pure math, no rendering dependencies).
 *
 * The circuit is a stadium (discorectangle) centerline: two straight
 * segments of STRAIGHT world units joined by two semicircles of RADIUS.
 * The road is TRACK.width wide, centered on the centerline, so the
 * drivable surface is every point within ROAD_HALF of the centerline.
 *
 * Coordinate convention (top-down view, XZ plane, +Y up):
 *   - The car starts at the origin (0, 0) on the centerline, heading +Z.
 *   - Straight 1 runs from (0,0) to (0,14) along +Z.
 *   - Both corners turn clockwise (as seen from above), i.e. to the car's
 *     right. Turn 1 sweeps around center (-8, 14); turn 2 around (-8, 0).
 *   - Heading angle θ maps to direction (sin θ, cos θ): θ = 0 is +Z and
 *     increasing θ is counter-clockwise from above, so steering clockwise
 *     decreases θ.
 */

export interface Vec {
  x: number;
  z: number;
}

export const TRACK = {
  /** Length of each straight centerline segment. */
  straight: 14,
  /** Radius of each corner semicircle (and of the car's turning circle). */
  radius: 8,
  /** Full drivable road width, centered on the path. */
  width: 4,
} as const;

export const STRAIGHT = TRACK.straight;
export const RADIUS = TRACK.radius;
export const ROAD_HALF = TRACK.width / 2;
export const ARC = Math.PI * RADIUS;
export const TOTAL_LENGTH = 2 * STRAIGHT + 2 * ARC;

/** Start / finish position (centerline). */
export const START: Vec = { x: 0, z: 0 };
/** End of straight 1 = entry of turn 1. */
export const STRAIGHT1_END: Vec = { x: 0, z: STRAIGHT };
/** Center of the turn 1 semicircle. */
export const TURN1_CENTER: Vec = { x: -RADIUS, z: STRAIGHT };
/** Start of straight 2 = exit of turn 1. */
export const STRAIGHT2_START: Vec = { x: -2 * RADIUS, z: STRAIGHT };
/** End of straight 2 = entry of turn 2. */
export const STRAIGHT2_END: Vec = { x: -2 * RADIUS, z: 0 };
/** Center of the turn 2 semicircle. */
export const TURN2_CENTER: Vec = { x: -RADIUS, z: 0 };

/** Wrap an arc-length coordinate into [0, TOTAL_LENGTH). */
export function wrapDistance(s: number): number {
  return ((s % TOTAL_LENGTH) + TOTAL_LENGTH) % TOTAL_LENGTH;
}

/** Point on the centerline at arc-length distance s from the start line. */
export function pointAt(s: number): Vec {
  s = wrapDistance(s);
  if (s < STRAIGHT) {
    return { x: 0, z: s };
  }
  s -= STRAIGHT;
  if (s < ARC) {
    const phi = s / RADIUS;
    return {
      x: TURN1_CENTER.x + RADIUS * Math.cos(phi),
      z: TURN1_CENTER.z + RADIUS * Math.sin(phi),
    };
  }
  s -= ARC;
  if (s < STRAIGHT) {
    return { x: STRAIGHT2_START.x, z: STRAIGHT - s };
  }
  s -= STRAIGHT;
  const phi = Math.PI + s / RADIUS;
  return {
    x: TURN2_CENTER.x + RADIUS * Math.cos(phi),
    z: TURN2_CENTER.z + RADIUS * Math.sin(phi),
  };
}

/** Unit tangent of the centerline at arc-length distance s. */
export function tangentAt(s: number): Vec {
  s = wrapDistance(s);
  if (s < STRAIGHT) {
    return { x: 0, z: 1 };
  }
  s -= STRAIGHT;
  if (s < ARC) {
    const phi = s / RADIUS;
    return { x: -Math.sin(phi), z: Math.cos(phi) };
  }
  s -= ARC;
  if (s < STRAIGHT) {
    return { x: 0, z: -1 };
  }
  s -= STRAIGHT;
  const phi = Math.PI + s / RADIUS;
  return { x: -Math.sin(phi), z: Math.cos(phi) };
}

/** Heading angle θ (direction (sin θ, cos θ)) of the centerline at s. */
export function headingAt(s: number): number {
  const t = tangentAt(s);
  return Math.atan2(t.x, t.z);
}

function distToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cz = az + t * dz;
  return Math.hypot(px - cx, pz - cz);
}

/**
 * Distance from a point to a circular arc. Returns Infinity when the
 * point's angle falls outside the arc's angular range; the arc's end
 * points are already covered by the adjacent straight segments.
 */
function distToArc(
  px: number,
  pz: number,
  cx: number,
  cz: number,
  a0: number,
  a1: number,
): number {
  const twoPi = Math.PI * 2;
  let ang = Math.atan2(pz - cz, px - cx);
  ang = a0 + (((ang - a0) % twoPi) + twoPi) % twoPi;
  if (ang <= a1) {
    return Math.abs(Math.hypot(px - cx, pz - cz) - RADIUS);
  }
  return Infinity;
}

/**
 * Shortest distance from a point to the centerline curve. The road is
 * every point within ROAD_HALF of this value.
 */
export function distanceToCenterline(px: number, pz: number): number {
  return Math.min(
    distToSegment(px, pz, 0, 0, 0, STRAIGHT),
    distToSegment(px, pz, STRAIGHT2_START.x, STRAIGHT2_START.z, STRAIGHT2_END.x, STRAIGHT2_END.z),
    distToArc(px, pz, TURN1_CENTER.x, TURN1_CENTER.z, 0, Math.PI),
    distToArc(px, pz, TURN2_CENTER.x, TURN2_CENTER.z, Math.PI, Math.PI * 2),
  );
}

/** A checkpoint gate: a segment spanning the full road width at distance s. */
export interface Gate {
  /** Checkpoint number 1..8 (8 is the start/finish line). */
  cp: number;
  /** Arc-length position on the centerline. */
  s: number;
  /** Gate center (on the centerline). */
  x: number;
  z: number;
  /** Unit tangent of the centerline (crossing direction). */
  tx: number;
  tz: number;
  /** Unit normal spanning the road (gate direction). */
  nx: number;
  nz: number;
}

/** Number of checkpoints per lap; checkpoint 8 sits on the start/finish line. */
export const NUM_CHECKPOINTS = 8;

/** Build the eight evenly spaced gates, ordered by checkpoint number. */
export function buildGates(): Gate[] {
  const gates: Gate[] = [];
  for (let cp = 1; cp <= NUM_CHECKPOINTS; cp++) {
    const s = wrapDistance(((cp % NUM_CHECKPOINTS) * TOTAL_LENGTH) / NUM_CHECKPOINTS);
    const p = pointAt(s);
    const t = tangentAt(s);
    gates.push({
      cp,
      s,
      x: p.x,
      z: p.z,
      tx: t.x,
      tz: t.z,
      nx: t.z,
      nz: -t.x,
    });
  }
  return gates;
}
