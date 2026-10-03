/**
 * Tiny Apex — unified keyboard / pointer input for the one-button control.
 *
 * Steering is "held" when either Space is down or the on-screen TURN
 * control is pressed. Both sources feed one boolean so keyboard and
 * pointer input stay consistent, including when both were held.
 *
 * Release paths are exhaustive: keyup, pointerup, pointercancel and
 * lostpointercapture all clear the flag, and pointer capture guarantees a
 * touch released after dragging off the button still releases steering.
 * Window blur / page hide clear everything and request a pause.
 */

export interface InputOptions {
  turnButton: HTMLButtonElement;
  /** Called when the user might need to be paused (blur / page hide). */
  onInterrupt: () => void;
  /** Space only steers while the race is running; otherwise it activates the focused overlay button. */
  isRacing: () => boolean;
}

export interface Input {
  /** Whether steering is currently held by any source. */
  held(): boolean;
  /** Clear all held input (used on state transitions and restart). */
  clear(): void;
  destroy(): void;
}

export function createInput(options: InputOptions): Input {
  const { turnButton, onInterrupt, isRacing } = options;

  let keyHeld = false;
  let pointerHeld = false;
  let activePointerId: number | null = null;
  const disposers: Array<() => void> = [];

  function on<T extends keyof WindowEventMap>(
    target: Window,
    type: T,
    listener: (ev: WindowEventMap[T]) => void,
    opts?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, listener, opts);
    disposers.push(() => target.removeEventListener(type, listener, opts));
  }

  function onElement<T extends keyof HTMLElementEventMap>(
    el: HTMLElement,
    type: T,
    listener: (ev: HTMLElementEventMap[T]) => void,
  ): void {
    el.addEventListener(type, listener);
    disposers.push(() => el.removeEventListener(type, listener));
  }

  const releasePointer = (ev?: PointerEvent) => {
    if (ev && activePointerId !== null && ev.pointerId !== activePointerId) {
      return;
    }
    pointerHeld = false;
    activePointerId = null;
    turnButton.classList.remove('is-held');
    turnButton.setAttribute('aria-pressed', 'false');
  };

  // --- Keyboard ---
  on(window, 'keydown', (e) => {
    if (e.code !== 'Space') return;
    if (isRacing()) {
      // Keep Space from scrolling the page during play.
      e.preventDefault();
      if (!e.repeat) keyHeld = true;
    }
    // Outside of a race we leave the default behavior alone so Space /
    // Enter activate the focused Start / Resume / Restart button.
  });
  on(window, 'keyup', (e) => {
    if (e.code !== 'Space') return;
    keyHeld = false;
  });

  // --- Pointer (touch + mouse) on the steering control ---
  onElement(turnButton, 'pointerdown', (e) => {
    e.preventDefault();
    turnButton.focus({ preventScroll: true });
    activePointerId = e.pointerId;
    try {
      turnButton.setPointerCapture(e.pointerId);
    } catch {
      // Some browsers throw if capture was already released; the flag still works.
    }
    pointerHeld = true;
    turnButton.classList.add('is-held');
    turnButton.setAttribute('aria-pressed', 'true');
  });
  onElement(turnButton, 'pointerup', releasePointer);
  onElement(turnButton, 'pointercancel', releasePointer);
  onElement(turnButton, 'lostpointercapture', releasePointer);
  onElement(turnButton, 'contextmenu', (e) => e.preventDefault());

  // --- Interruptions: clear input and ask for a pause ---
  const interrupt = () => {
    keyHeld = false;
    releasePointer();
    onInterrupt();
  };
  on(window, 'blur', interrupt);
  const onVisibility = () => {
    if (document.hidden) interrupt();
  };
  document.addEventListener('visibilitychange', onVisibility);
  disposers.push(() => document.removeEventListener('visibilitychange', onVisibility));

  return {
    held: () => keyHeld || pointerHeld,
    clear: () => {
      keyHeld = false;
      releasePointer();
    },
    destroy: () => {
      for (const dispose of disposers.splice(0)) dispose();
    },
  };
}
