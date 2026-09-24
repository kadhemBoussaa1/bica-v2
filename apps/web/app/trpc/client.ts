"use client";

import { createTRPCContext } from "@trpc/tanstack-react-query";
// Type-only import: erased at compile time, so no server code reaches the bundle.
import type { AppRouter } from "api/src/trpc/trpc.router";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();
