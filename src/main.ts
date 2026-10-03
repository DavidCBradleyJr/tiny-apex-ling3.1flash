/**
 * Tiny Apex — bootstrap, fixed-timestep loop and state transitions.
 *
 * The simulation (src/sim.ts) is fully decoupled from rendering: one
 * requestAnimationFrame loop feeds an accumulator with a fixed 1/120 s
 * step, so gameplay is identical at any display frame rate. Catch-up
 * after a long interruption is bounded and the clock is reset on
 * pause/resume so the car never leaps forward.
 */

import * as THREE from 'three';
import { Car } from './car.js';
import { Effects } from './effects.js';
import { createInput } from './input.js';
import { grabUI, UI } from './ui.js';
import { buildWorld } from './world.js';
import {
  initialState,
  pause,
  reset,
  resume,
  SIM_STEP,
  step,
} from './sim.js';
import type { GameState, SimState } from './sim.js';

const canvas = document.getElementById('game') as HTMLCanvasElement;

function showFatal(message: string): void {
  const el = document.getElementById('fatal');
  if (!el) return;
  el.classList.remove('hidden');
  const card = document.createElement('div');
  card.className = 'card';
  const heading = document.createElement('h2');
  heading.textContent = 'Cannot start Tiny Apex';
  const para = document.createElement('p');
  para.textContent = message;
  card.append(heading, para);
  el.append(card);
}

// ---------- Renderer (with a readable failure path) ----------
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch {
  showFatal(
    'WebGL is unavailable in this browser or device. Tiny Apex needs it to draw the circuit — try a browser with hardware acceleration enabled.',
  );
  throw new Error('WebGL renderer creation failed');
}
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  showFatal('The graphics context was lost. Please reload the page to restart.');
});

// Graceful degradation: software GL renderers (SwiftShader,
// llvmpipe) fail on the shadow depth pass, so shadow maps
// are disabled there. Real GPUs keep the full look.
// The software marker only appears in the unmasked
// renderer strings (WEBGL_debug_renderer_info).
const gl = renderer.getContext();
const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
const glInfo = debugInfo
  ? String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)) +
    ' ' +
    String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
  : String(gl.getParameter(gl.VERSION));
const isSoftwareGL = /swiftshader|llvmpipe|software|mesa/i.test(glInfo);
renderer.shadowMap.enabled = !isSoftwareGL;
if (isSoftwareGL) {
  console.info('Tiny Apex: software GL detected — shadow maps disabled');
}

// ---------- World, car, effects ----------
const world = buildWorld();
const car = new Car();
world.scene.add(car.group);

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const effects = new Effects(world.scene, reducedMotion);

// ---------- Simulation ----------
const sim: SimState = initialState();

// ---------- UI ----------
const ui = new UI(grabUI(), {
  'overlay-ready': 'start-btn',
  'overlay-paused': 'resume-btn',
  'overlay-crashed': 'restart-btn',
});
ui.setState(sim.state); // paint the initial badge state
ui.showOverlay('ready');
world.setNextCheckpoint(sim.nextCheckpoint);

// ---------- Input ----------
const input = createInput({
  turnButton: (document.getElementById('turn-btn') as HTMLButtonElement),
  isRacing: () => sim.state === 'racing',
  onInterrupt: () => {
    // Window blur / page hide: clear input and pause, never auto-resume.
    if (sim.state === 'racing') {
      pause(sim);
      ui.showOverlay('paused');
    }
  },
});

// ---------- Clock reset (used by start / resume / restart) ----------
let acc = 0;
let last = performance.now();
function resetClock(): void {
  acc = 0;
  last = performance.now();
}

// ---------- State transitions ----------
function beginRun(): void {
  reset(sim);
  sim.state = 'racing';
  input.clear();
  effects.clear();
  world.hideCrashMarker();
  world.setNextCheckpoint(sim.nextCheckpoint);
  ui.showOverlay(null);
  ui.setState('racing');
  resetClock();
}

function resumeRun(): void {
  resume(sim);
  input.clear();
  ui.showOverlay(null);
  resetClock();
}

function onCrashed(): void {
  ui.showOverlay('crashed');
  ui.showCrashResult(sim.points, sim.laps);
  ui.flashCrash();
  if (sim.crash) world.showCrashMarker(sim.crash.x, sim.crash.z);
}

function bindButton(id: string, action: () => void): void {
  const el = document.getElementById(id) as HTMLButtonElement;
  el.addEventListener('click', () => {
    el.blur(); // never leave a hidden button focused (and Space-armed)
    action();
  });
}

bindButton('start-btn', beginRun);
bindButton('restart-btn', beginRun);
bindButton('restart-btn-pause', beginRun);
bindButton('resume-btn', resumeRun);

// ---------- Viewport ----------
function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  world.fitView(w, h);
}
window.addEventListener('resize', resize);
resize();

// ---------- Rear-wheel emitter positions (world space) ----------
const emitters = {
  left: new THREE.Vector3(),
  right: new THREE.Vector3(),
};
function updateEmitters(): void {
  const fx = Math.sin(sim.heading);
  const fz = Math.cos(sim.heading);
  const lx = Math.cos(sim.heading);
  const lz = -Math.sin(sim.heading);
  const cx = sim.x - fx * 0.48;
  const cz = sim.z - fz * 0.48;
  emitters.left.set(cx + lx * 0.5, 0.05, cz + lz * 0.5);
  emitters.right.set(cx - lx * 0.5, 0.05, cz - lz * 0.5);
}

// ---------- Main loop ----------
let reportedState: GameState | null = null;
function frame(now: number): void {
  requestAnimationFrame(frame);

  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25; // bound catch-up after a long interruption

  const prevLaps = sim.laps;
  const prevCp = sim.nextCheckpoint;

  if (sim.state === 'racing') {
    acc += dt;
    let steps = 0;
    while (acc >= SIM_STEP && sim.state === 'racing') {
      step(sim, SIM_STEP, input.held());
      acc -= SIM_STEP;
      if (++steps >= 40) {
        acc = 0;
        break;
      }
    }
  } else {
    acc = 0;
  }

  // React to transitions. The reported-state tracker catches
  // changes made between frames (e.g. a blur pausing the
  // race outside the rAF callback), which a frame-start
  // snapshot would miss.
  if (sim.state !== reportedState) {
    reportedState = sim.state;
    ui.setState(sim.state);
    if (sim.state === 'crashed') onCrashed();
    else if (sim.state === 'paused') ui.showOverlay('paused');
  }
  if (sim.laps !== prevLaps && sim.laps > 0) {
    ui.showToast(`Lap ${sim.laps} complete!`);
  }
  if (sim.nextCheckpoint !== prevCp) {
    world.setNextCheckpoint(sim.nextCheckpoint);
  }

  // Cosmetic frame (frozen while paused).
  const visualDt = sim.state === 'paused' ? 0 : dt;
  car.update({
    x: sim.x,
    z: sim.z,
    heading: sim.heading,
    steering: sim.steering,
    moving: sim.state === 'racing' ? 1 : 0,
    dt: visualDt,
    reducedMotion,
  });

  if (sim.state === 'racing' && sim.steering) {
    updateEmitters();
    effects.emit(visualDt, true, emitters, sim.heading);
  }
  effects.update(visualDt);
  world.update(visualDt);

  ui.setStats(sim.points, sim.laps, sim.nextCheckpoint);

  renderer.render(world.scene, world.camera);
}

requestAnimationFrame(frame);

// Dev-only inspection handle for browser verification.
if (import.meta.env.DEV) {
  (window as unknown as { __tinyApex?: unknown }).__tinyApex = {
    sim,
    SIM_STEP,
  };
}
