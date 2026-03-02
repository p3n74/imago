import { env } from "@template/env/web";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: import.meta.env.DEV ? (typeof window !== "undefined" ? window.location.origin : env.VITE_SERVER_URL) : env.VITE_SERVER_URL,
});
