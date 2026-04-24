import { handlers } from "@/auth";

// Delegate all GET and POST requests under /api/auth/* to NextAuth.
// This covers: sign-in, sign-out, session checks, CSRF tokens.
export const { GET, POST } = handlers;
