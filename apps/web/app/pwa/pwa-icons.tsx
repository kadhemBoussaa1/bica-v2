/*
 * The installed app's glyphs, on the nav's 18px grid (nav-icons.tsx):
 * 1.5 stroke, round caps, currentColor.
 */

const svg = {
  width: 18,
  height: 18,
  viewBox: "0 0 18 18",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** A phone with an arrow into it: "put this app on the device". */
export function InstallIcon() {
  return (
    <svg {...svg}>
      <rect x="4.5" y="1.75" width="9" height="14.5" rx="2" />
      <path d="M9 5.5v5.25" />
      <path d="m6.75 8.5 2.25 2.25 2.25-2.25" />
      <path d="M7.75 13.75h2.5" />
    </svg>
  );
}

/** Safari's Share button: a box with an arrow out of its top. */
export function ShareIcon() {
  return (
    <svg {...svg}>
      <path d="M9 1.75v9" />
      <path d="M6.25 4.5 9 1.75l2.75 2.75" />
      <path d="M6 7.25H4.75a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1H12" />
    </svg>
  );
}

/** "Add to Home Screen" in the Share sheet: a plus in a rounded square. */
export function AddSquareIcon() {
  return (
    <svg {...svg}>
      <rect x="2.25" y="2.25" width="13.5" height="13.5" rx="3" />
      <path d="M9 6v6M6 9h6" />
    </svg>
  );
}

/** No signal: the offline banner's mark. */
export function OfflineIcon() {
  return (
    <svg {...svg} width={16} height={16}>
      <path d="M1.75 6.75a10.5 10.5 0 0 1 3-1.9" />
      <path d="M7.75 3.9a10.5 10.5 0 0 1 8.5 2.85" />
      <path d="M4.25 9.5a7 7 0 0 1 3.4-1.8" />
      <path d="M11.4 8.1a7 7 0 0 1 2.35 1.4" />
      <path d="M6.75 12.25a3.5 3.5 0 0 1 4.5 0" />
      <path d="m2.25 2.25 13.5 13.5" />
    </svg>
  );
}
