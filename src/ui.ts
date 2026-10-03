/**
 * Tiny Apex — HUD and overlay wiring (DOM only, no game logic).
 */

import type { GameState } from './sim.js';

export interface UIElements {
  points: HTMLElement;
  laps: HTMLElement;
  nextCp: HTMLElement;
  stateBadge: HTMLElement;
  hint: HTMLElement;
  toast: HTMLElement;
  turnBtn: HTMLButtonElement;
  overlays: {
    ready: HTMLElement;
    paused: HTMLElement;
    crashed: HTMLElement;
  };
  crashResult: HTMLElement;
  crashFlash: HTMLElement;
}

export function grabUI(): UIElements {
  const $ = <T extends HTMLElement>(id: string): T => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing DOM element #${id}`);
    return el as T;
  };
  return {
    points: $('points'),
    laps: $('laps'),
    nextCp: $('next-cp'),
    stateBadge: $('state-badge'),
    hint: $('hint'),
    toast: $('toast'),
    turnBtn: $('turn-btn') as HTMLButtonElement,
    overlays: {
      ready: $('overlay-ready'),
      paused: $('overlay-paused'),
      crashed: $('overlay-crashed'),
    },
    crashResult: $('crash-result'),
    crashFlash: $('crash-flash'),
  };
}

export class UI {
  private lastPoints = -1;
  private lastLaps = -1;
  private lastCp = -1;
  private lastState: GameState | null = null;
  private toastTimer: number | null = null;
  private reducedMotion: boolean;

  constructor(
    private ui: UIElements,
    /** Map of overlay element id -> its primary button id, for keyboard focus. */
    private primaryButtons: Record<string, string>,
  ) {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  showOverlay(name: 'ready' | 'paused' | 'crashed' | null): void {
    for (const [key, el] of Object.entries(this.ui.overlays)) {
      el.classList.toggle('hidden', key !== name);
    }
    if (name) {
      const button = document.getElementById(this.primaryButtons[name]);
      button?.focus({ preventScroll: true });
    }
  }

  setState(state: GameState): void {
    if (state === this.lastState) return;
    this.lastState = state;
    this.ui.stateBadge.textContent =
      state === 'ready' ? 'Ready' : state === 'racing' ? 'Racing' : state === 'paused' ? 'Paused' : 'Crashed';
    this.ui.stateBadge.dataset.state = state;
    this.ui.hint.classList.toggle('hidden', state !== 'racing' && state !== 'paused');
  }

  setStats(points: number, laps: number, nextCp: number): void {
    if (points !== this.lastPoints) {
      this.lastPoints = points;
      this.ui.points.textContent = String(points);
      if (this.lastPoints > 0) this.bump(this.ui.points);
    }
    if (laps !== this.lastLaps) {
      this.lastLaps = laps;
      this.ui.laps.textContent = String(laps);
    }
    if (nextCp !== this.lastCp) {
      this.lastCp = nextCp;
      this.ui.nextCp.textContent = `CP ${nextCp}`;
    }
  }

  /** Brief non-modal message (lap notices). Honors reduced motion. */
  showToast(text: string, ms = 1600): void {
    const el = this.ui.toast;
    el.textContent = text;
    el.classList.add('show');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
  }

  showCrashResult(points: number, laps: number): void {
    this.ui.crashResult.textContent = `${points} point${points === 1 ? '' : 's'} · ${laps} lap${laps === 1 ? '' : 's'}`;
  }

  /** Subtle red vignette flash on crash; instant-off under reduced motion. */
  flashCrash(): void {
    const el = this.ui.crashFlash;
    el.classList.add('show');
    window.setTimeout(() => el.classList.remove('show'), this.reducedMotion ? 60 : 700);
  }

  private bump(el: HTMLElement): void {
    if (this.reducedMotion) return;
    el.classList.remove('bump');
    // Restart the CSS animation.
    void el.offsetWidth;
    el.classList.add('bump');
  }
}
