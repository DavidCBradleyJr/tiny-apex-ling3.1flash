# Original task prompt

The task specification that produced this project, as recorded
in the session checkpoint (2026-10-02). Kept here so the repo
is self-contained: what was asked, in the order it was asked.

## Objective

Build "Tiny Apex", a finished, polished, playable one-button
arcade racing game in `/run/media/deej/External 4TB/devdeej/
Tiny-Apex/Ling`, verify it in a browser at 1440x900 and
390x844, and report measured wall-clock time (task start unix
time 1790993878).

## Requirements

- **Gameplay contract**: stadium circuit (straights = 14,
  corner radius = 8, road width = 4); car speed 8 u/s;
  steering 1 rad/s clockwise while held (turning radius 8
  matches the track); collision circle radius 0.65 (crash when
  the car's center is > 1.35 from the centerline); 8 evenly
  spaced checkpoints with CP8 at start/finish; 1 point per
  in-order gate crossing; laps increment after CP8.
- Fixed 1/120 s timestep with an accumulator; states
  `ready / racing / paused / crashed`.
- Input: **Space** key + on-screen **TURN** button (≥ 64 px);
  pause on blur/hidden with a Resume control and no
  auto-resume.
- Viewports **1440x900** and **390x844**; all art authored in
  code (Three.js primitives, canvas textures, system fonts);
  no external assets.
- Vanilla TS + Vite + Three.js; npm scripts
  `dev / typecheck / build / preview / test`; `node:test`
  tests for sim / collision / checkpoint / reset; README with
  versions and commands; browser-verify gameplay; report
  measured wall-clock time.

## Outcome (2026-10-02)

- 30 `node:test` cases pass; typecheck and production build
  clean; 28/28 headless-browser checks pass at both viewports
  (states, scoring, two full laps on a perfect hold schedule,
  pause-on-blur with no auto-resume, crash/restart, mobile
  TURN button ≥ 64 px, no horizontal overflow, no console
  errors).
- Measured wall-clock time: **1 h 10 m 49 s**
  (unix 1790993878 → 1790998127).
- Two real bugs found and fixed by the browser pass: the state
  badge never painted on load, and the pause badge did not
  update when a blur paused the race between frames (fixed
  with a reported-state tracker instead of a frame-start
  snapshot).
