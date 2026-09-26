/**
 * The API origin the browser talks to. tRPC, Better Auth, the PDF routes
 * and the notification stream all live there, so it is read once here and
 * imported everywhere else. Inlined by Next at build time from
 * `NEXT_PUBLIC_API_URL`; the default is the dev API.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
