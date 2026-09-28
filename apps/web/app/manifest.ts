import type { MetadataRoute } from "next";

/**
 * The installed app, on the warehouse handheld and every phone
 * (docs/pwa-plan.md).
 *
 * The receiving screen runs on an Inateck N6029 (Android, Chrome) held in one
 * hand over a pallet, so "Add to Home screen" and `display: standalone` are
 * what make it a scanner rather than a browser tab — no URL bar to mis-tap,
 * and it survives an app switch.
 *
 * Fetched WITHOUT cookies by the browser, which is why `middleware.ts` has to
 * exempt it: a redirect to /login here makes the app uninstallable. It is
 * also why the name stays untranslated — no cookie, no locale.
 *
 * Everyone lands on `/`: no role-based start page and no `shortcuts`. No
 * `orientation` either, because the shop-floor tablets run landscape.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Bicapack ERP",
    short_name: "Bicapack",
    description: "Kraft paper bag production — orders, stock and receiving.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // --bp-page and --bp-orange-500 in tokens.css, so the splash and the
    // status bar do not flash a colour the app never uses. The viewport's
    // themeColor in layout.tsx must match.
    background_color: "#efe9e0",
    theme_color: "#f29100",
    // The logo on the rail's ink: its "pack" is white on nothing, so a light
    // tile would lose it and an orange one would swallow the orange block.
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
