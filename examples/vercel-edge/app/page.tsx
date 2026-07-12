import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

// This page runs on the server.
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();

  // Already signed in → skip the form and go straight to chat.
  if (session) redirect("/chat");

  const { error } = await searchParams;

  return (
    <div style={{ maxWidth: 360, margin: "8rem auto", padding: "2rem", background: "#fff", borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}>
      <h1 style={{ marginTop: 0, fontSize: "1.4rem" }}>Behest Edge Example</h1>
      <p style={{ color: "#666", fontSize: "0.9rem" }}>
        Demo users: <b>alice / alice123</b> or <b>bob / bob123</b>
      </p>

      {/* Show error message if sign-in failed */}
      {error && (
        <p style={{ color: "#c00", fontSize: "0.9rem", margin: "0 0 0.5rem" }}>
          Invalid username or password.
        </p>
      )}

      {/* Server Action — the form posts directly to the server without any JS fetch calls */}
      <form
        action={async (formData: FormData) => {
          "use server";
          try {
            await signIn("credentials", {
              username: formData.get("username"),
              password: formData.get("password"),
              redirectTo: "/chat",
            });
          } catch (err) {
            // AuthError means wrong credentials — redirect back with ?error so
            // the page can show a message. Re-throw everything else (including
            // NEXT_REDIRECT, which is how a successful sign-in redirects).
            if (err instanceof AuthError) redirect(`/?error=${err.type}`);
            throw err;
          }
        }}
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
      >
        <input
          name="username"
          placeholder="Username"
          required
          style={{ padding: "0.5rem", borderRadius: 6, border: "1px solid #ccc", fontSize: "1rem" }}
        />
        <input
          name="password"
          type="password"
          placeholder="Password"
          required
          style={{ padding: "0.5rem", borderRadius: 6, border: "1px solid #ccc", fontSize: "1rem" }}
        />
        <button
          type="submit"
          style={{ padding: "0.6rem", borderRadius: 6, background: "#0070f3", color: "#fff", border: "none", fontSize: "1rem", cursor: "pointer" }}
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
