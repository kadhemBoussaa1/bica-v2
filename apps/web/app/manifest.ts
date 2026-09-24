import type { MetadataRoute } from "next";

/**
 * Installable on the warehouse handheld.
 *
 * The receiving screen runs on an Inateck N6029 (Android, Chrome) held in one
 * hand over a pallet, so "Add to Home screen" and `display: standalone` are
 * what make it a scanner rather than a browser tab — no URL bar to mis-tap,
 * and it survives an app switch.
 *
 * Fetched WITHOUT cookies by the browser, which is why `middleware.ts` has to
 * exempt it: a redirect to /login here makes the app uninstallable.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bicapack ERP",
    short_name: "Bicapack",
    description: "Kraft paper bag production — orders, stock and receiving.",
    start_url: "/",
    display: "standalone",
    // Matches --bp-page and the primary orange in tokens.css, so the splash
    // and status bar do not flash a colour the app never uses.
    background_color: "#f6f4f1",
    theme_color: "#e8622a",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
