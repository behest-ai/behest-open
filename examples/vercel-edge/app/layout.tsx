import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Behest Vercel Edge Example",
  description: "Behest + Next.js 15 App Router on Vercel Edge Runtime",
};

// Root layout — every page in the app is wrapped in this HTML shell.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "sans-serif", background: "#f9f9f9" }}>
        {children}
      </body>
    </html>
  );
}
