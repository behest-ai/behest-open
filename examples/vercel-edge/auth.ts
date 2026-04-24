import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

// Demo users — same pattern as behest-chat-demo.
// In a real app, replace this with a database lookup + password hashing.
const DEMO_USERS: Record<string, { id: string; name: string; password: string }> = {
  alice: { id: "alice", name: "Alice", password: "alice123" },
  bob:   { id: "bob",   name: "Bob",   password: "bob123"   },
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const username = (credentials?.username as string | undefined)?.trim();
        const password = (credentials?.password as string | undefined)?.trim();
        if (!username || !password) return null;

        const user = DEMO_USERS[username];
        if (!user || user.password !== password) return null;

        // Return the user object — NextAuth stores id + name in the JWT.
        return { id: user.id, name: user.name };
      },
    }),
  ],

  // JWT strategy: session stored in a signed cookie, no database needed.
  // This also works on Vercel's Edge Runtime.
  session: { strategy: "jwt" },

  callbacks: {
    // Copy user.id into the JWT when the user first signs in.
    jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      return token;
    },
    // Expose token.id on session.user so our routes can read it.
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      return session;
    },
  },

  pages: {
    signIn: "/",  // Use our own home page as the sign-in page.
  },
});
