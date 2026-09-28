"use client";

import { useSyncExternalStore } from "react";
import { canPromptInstall, promptInstall, subscribeInstallPrompt } from "./install-store";

const STANDALONE = "(display-mode: standalone)";

function subscribeDisplayMode(listener: () => void): () => void {
  const query = window.matchMedia(STANDALONE);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** Launched from the Home Screen or as an installed app, not in a tab. */
function readStandalone(): boolean {
  return (
    window.matchMedia(STANDALONE).matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * iPhone, iPod and iPad. iPadOS asks for desktop sites by default and names
 * itself a Mac, so a "Mac" with a touch screen is an iPad.
 */
function readIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

const never = () => () => {};
const no = () => false;

/**
 * What the device allows: Chrome's prompt (Android, desktop), the manual
 * "Add to Home Screen" steps (iOS, which has no prompt), or nothing
 * (already installed, or a browser that cannot install). Every value is
 * false on the server and during hydration.
 */
export function useInstall() {
  const canPrompt = useSyncExternalStore(subscribeInstallPrompt, canPromptInstall, no);
  const isStandalone = useSyncExternalStore(subscribeDisplayMode, readStandalone, no);
  const isIos = useSyncExternalStore(never, readIos, no);
  return { canPrompt, isIos, isStandalone, prompt: promptInstall };
}
