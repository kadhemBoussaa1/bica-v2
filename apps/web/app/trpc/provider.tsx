"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { useState, type ReactNode } from "react";
import type { AppRouter } from "api/src/trpc/trpc.router";
import { useTranslations } from "next-intl";
import { UiStringsProvider, type UiStrings } from "@repo/ui/strings";
import { ToastProvider } from "@repo/ui/toast";
import { TRPCProvider } from "./client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * The toolkit's own few words (pager, "All", "Cancel", loading), translated
 * here because `@repo/ui` has no translation layer of its own.
 */
function UiStringsFromMessages({ children }: { children: ReactNode }) {
  const t = useTranslations("common");
  const strings: UiStrings = {
    all: t("all"),
    prev: t("prev"),
    next: t("next"),
    search: t("search"),
    nothingMatches: t("nothingMatches"),
    cancel: t("cancel"),
    working: t("working"),
    close: t("close"),
    dismiss: t("dismiss"),
    loading: t("loading"),
    rangeOf: (start, end, total) => t("rangeOf", { start, end, total }),
    zeroOfZero: t("zeroOfZero"),
    perPage: t("perPage"),
  };
  return <UiStringsProvider value={strings}>{children}</UiStringsProvider>;
}

export function Providers({ children }: { children: ReactNode }) {
  // useState keeps both clients stable across re-renders.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000 } },
      }),
  );
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: `${API_URL}/trpc`,
          // The session lives in an HttpOnly cookie on the API origin, so
          // cross-origin requests must opt in to sending it. Without this
          // every procedure runs anonymous and `me` returns null.
          fetch: (url, options) =>
            fetch(url, { ...options, credentials: "include" }),
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <UiStringsFromMessages>
          <ToastProvider>{children}</ToastProvider>
        </UiStringsFromMessages>
      </TRPCProvider>
    </QueryClientProvider>
  );
}
