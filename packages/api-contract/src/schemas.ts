import { z } from "zod";
import { roleSchema } from "./roles.js";

// --- users ---

export const createUserInput = z.object({
  email: z.email("A valid email is required"),
  name: z.string().min(1, "Name is required").max(120),
  // 128 is Better Auth's default maxPasswordLength; above it the library
  // refuses the password, so the form says so first.
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(128, "Password must be at most 128 characters"),
  role: roleSchema,
});

export const userIdInput = z.object({ id: z.string() });

export const setUserRoleInput = z.object({
  id: z.string(),
  role: roleSchema,
});

export const setUserBannedInput = z.object({
  id: z.string(),
  banned: z.boolean(),
  reason: z.string().max(500).optional(),
});

export const signInInput = z.object({
  email: z.email(),
  password: z.string().min(1, "Password is required"),
});

export type CreateUserInput = z.infer<typeof createUserInput>;
export type SetUserRoleInput = z.infer<typeof setUserRoleInput>;
