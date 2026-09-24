import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/**
 * Hosts allowed to request the dev server's assets, beyond localhost.
 *
 * Next blocks cross-origin requests to dev-only assets by default, so opening
 * the app on a LAN address — the warehouse handheld or a phone testing the
 * receiving scan screen — serves the HTML but 403s every `/_next/static`
 * chunk, leaving a page that renders its shell and never hydrates.
 *
 * Set `DEV_ORIGIN` to the machine's LAN address (e.g. 192.168.1.195) when
 * testing on a device. Development only; the option is ignored in a build.
 */
/* global process */
const devOrigin = process.env.DEV_ORIGIN;

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(devOrigin ? { allowedDevOrigins: [devOrigin] } : {}),
  /**
   * The production image runs `.next/standalone/apps/web/server.js`, which
   * carries only the node_modules the server actually traces to, instead of
   * the whole workspace install (Dockerfile.prod, runner-web). The tracing
   * root is inferred from pnpm-lock.yaml, i.e. the monorepo root. `next
   * start` still works on such a build, with a warning.
   */
  output: "standalone",
  /**
   * The settings module (2026-09-23) took over /users and /activity. The old
   * URLs live on in bookmarks and browser history, so they forward — query
   * string included, which is what the activity filters ride on. Temporary
   * (307) on purpose: browsers cache a permanent redirect, and it could not
   * be taken back.
   */
  async redirects() {
    return [
      {
        source: "/users/:path*",
        destination: "/settings/users/:path*",
        permanent: false,
      },
      {
        source: "/activity",
        destination: "/settings/activity",
        permanent: false,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
