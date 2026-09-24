"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTRPC } from "../trpc/client";
import { signIn, signOut } from "./client";

/**
 * The signed-in user, read through tRPC's `me` rather than Better Auth's own
 * useSession. Both would work, but `me` is resolved by the same context the
 * procedures authorize against, so the UI can never disagree with the API
 * about who you are or what role you hold.
 */
export function useCurrentUser() {
  const trpc = useTRPC();
  const { data, isPending } = useQuery(trpc.me.queryOptions());
  return { user: data ?? null, isPending };
}

/**
 * Signs in, then clears every cached query before navigating.
 *
 * The cache is the whole point: `me` was already fetched on the login page and
 * cached as null, and with a non-zero staleTime React Query will keep serving
 * that null after the cookie is set. The session header would then stay hidden
 * until a full reload dropped the cache. Clearing forces a refetch as the new
 * user.
 */
export function useSignIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (credentials: { email: string; password: string }) => {
      const { error } = await signIn.email(credentials);
      // Better Auth reports failures in the payload rather than throwing, so
      // rethrow to put the mutation into its error state.
      if (error) {
        throw new Error(error.message ?? "Sign-in failed. Try again.");
      }
    },
    onSuccess: () => {
      queryClient.clear();
    },
  });
}

/**
 * Signs out, then clears every cached query. Without the reset, React Query
 * would keep serving the previous user's data from cache after the session
 * cookie is gone.
 */
export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await signOut();
    },
    onSuccess: async () => {
      queryClient.clear();
      router.replace("/login");
      router.refresh();
    },
  });
}
