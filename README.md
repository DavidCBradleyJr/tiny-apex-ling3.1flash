# Tiny Apex

A one-button arcade racing toy on a miniature desert stadium circuit.
Hold **Space** (or the on-screen **TURN** button) to steer clockwise;
release to run straight. The steering rate and car speed are tuned so the
turning circle matches the track's corners exactly — timing your holds is
the whole game.

All art is authored in code (Three.js primitives, canvas-generated
textures, system fonts). No external assets.

## Play

- **Space** (hold/release) or the **TURN** button (touch/mouse) — steer
- **Enter / button** — start, resume, restart
- The window pauses automatically when it loses focus; it never
  auto-resumes — press Resume yourself.

Score **1 point** per checkpoint gate crossed in order (8 gates, the last
at the start/finish line); a lap is counted when you clear gate 8.
Leave the road (car centre more than 1.35 units from the centreline) and
you crash — instantly restartable, partial score kept.

## Commands

```sh
npm install      # install dependencies
npm run dev      # dev server (Vite, default http://localhost:5173)
npm run typecheck
npm test         # compile tests, then run node:test suite
npm run build    # typecheck + production build to dist/
npm run preview  # serve the production build (http://localhost:4173)
```

## Versions

- three 0.186.1, typescript 7.0.2, vite 8.3.2,
  @types/node 26.6.4, @types/three 0.186.0
- Node.js 22+ (uses `node --test` and npm scripts)

## How it works

- **Pure simulation** (`src/sim.ts`, `src/track.ts`) — fixed 1/120 s
  timestep driven by an accumulator in `src/main.ts`, so gameplay is
  identical at any display frame rate. Track is a stadium curve
  (straights 14, corner radius 8, road width 4). Car speed 8 u/s,
  steering 1 rad/s while held → turning radius 8, matching the corners.
- **Collision** — distance from the car to the track centreline; crash
  when it exceeds road half-width minus car radius (1.35).
- **Checkpoints** — 8 evenly spaced gates; crossing gate *n* while it is
  the next one scores a point; gate 8 wraps to a new lap.
- **Rendering** (`src/world.ts`, `src/car.ts`, `src/effects.ts`) —
  orthographic camera fitted to the viewport, seeded scenery, soft
  shadows, dust while steering, crash flash. On software GL renderers
  (SwiftShader/llvmpipe) shadow maps are auto-disabled.
- **States** — `ready → racing ⇄ paused → crashed`, with a
  reported-state tracker so UI updates even for changes made between
  frames (e.g. a blur-pause).
- **Tests** (`test/`) — 29 `node:test` cases covering track geometry,
  the sim state machine, collision, checkpoint order/laps, reset, and
  scripted drivers (perfect line, never-steer crash, off-line laps).

## Verified gameplay

Browser-verified (headless Chromium via puppeteer-core) at 1440×900 and
390×844: state transitions, scoring, two full laps on the perfect
Space-hold schedule, pause-on-blur with no auto-resume, crash +
restart, TURN button ≥ 64 px and steering on mobile, no horizontal
overflow, canvas rendering non-background pixels, no console errors.

In development, `window.__tinyApex` exposes `{ sim, SIM_STEP }` for
programmatic inspection (stripped from production builds).
