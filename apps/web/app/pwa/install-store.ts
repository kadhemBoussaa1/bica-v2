/**
 * Chrome's install prompt, held for the sidebar's "Install app" row.
 *
 * `beforeinstallprompt` can fire before React hydrates, so the listeners go
 * on at module load (this module reaches the browser with the root layout's
 * PwaRegistrar) rather than in an effect that could miss it. Calling
 * `preventDefault` keeps Chrome's own mini-infobar from covering the page;
 * the row is the way in. The event can be prompted once: after that the row
 * waits for the next one, which Chrome sends on a later visit if the user
 * dismissed it.
 *
 * iOS has no such event — the row opens the "Add to Home Screen" steps
 * there instead (use-install.ts).
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
/** A primitive, so `useSyncExternalStore` compares it by value. */
let canPrompt = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (next === canPrompt) return;
  canPrompt = next;
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    set(true);
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    set(false);
  });
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function canPromptInstall(): boolean {
  return canPrompt;
}

/**
 * Shows Chrome's install dialog; true when the user accepted. A refused
 * call (no user gesture) keeps the event for the next tap and never throws:
 * the row fires it and forgets it.
 */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  try {
    await event.prompt();
  } catch {
    return false;
  }
  deferred = null;
  set(false);
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}
