"use client";

import { createAuthClient } from "better-auth/react";
import { adminClient, inferAdditionalFields } from "better-auth/client/plugins";
import { ROLES } from "@repo/api-contract";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Better Auth browser client. `baseURL` points at the API origin because auth
 * is mounted there (`/api/auth/*` in apps/api), not on the Next server.
 *
 * `inferAdditionalFields` re-declares the custom columns the server adds to
 * User so `session.user.role` is typed here instead of `unknown`.
 */
export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
    adminClient(),
    inferAdditionalFields({
      user: {
        role: { type: "string", required: true, input: false },
        createdById: { type: "string", required: false, input: false },
      },
    }),
  ],
});

export const { signIn, signOut, useSession } = authClient;

export { ROLES };
