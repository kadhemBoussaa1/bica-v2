"use client";

/**
 * A beep and a buzz for each scan outcome.
 *
 * The operator is looking at the pallet, not the screen, so the result has to
 * be audible. Tones are synthesised rather than shipped as audio files: two
 * short sine blips need no asset, no network and no decode.
 *
 * The AudioContext is created lazily on first use because a browser refuses
 * to start one before a user gesture — the scan screen's "tap to arm" is that
 * gesture, and creating it at module load would leave a permanently suspended
 * context on Android.
 */
let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (context) return context;
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context = new Ctor();
  return context;
}

function tone(frequency: number, ms: number, delayMs = 0) {
  const ctx = audio();
  if (!ctx) return;
  // A context created before the gesture lands can still be suspended.
  if (ctx.state === "suspended") void ctx.resume();

  const start = ctx.currentTime + delayMs / 1000;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  // A short ramp at each end: a square-edged blip clicks on a small speaker.
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.25, start + 0.01);
  gain.gain.linearRampToValueAtTime(0, start + ms / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + ms / 1000 + 0.02);
}

function buzz(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

/** A reel went in: one short high blip. */
export function signalReceived() {
  tone(1320, 90);
  buzz(40);
}

/** Already scanned: two soft mid blips, distinct from success without alarming. */
export function signalAlready() {
  tone(880, 70);
  tone(880, 70, 110);
  buzz([30, 60, 30]);
}

/** Refused: a low buzz that cannot be mistaken for either of the above. */
export function signalRefused() {
  tone(220, 260);
  buzz([80, 50, 160]);
}

/**
 * Primes the audio context from a user gesture.
 *
 * Called by the scan zone's tap handler so the first real scan is audible —
 * without it the first beep is swallowed while the context starts.
 */
export function primeAudio() {
  const ctx = audio();
  if (ctx?.state === "suspended") void ctx.resume();
}
