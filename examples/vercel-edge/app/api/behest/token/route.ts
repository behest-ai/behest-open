import { NextResponse } from "next/server";
import { Behest } from "@behest/client-ts";
import { auth } from "@/auth";

// Reads BEHEST_KEY + BEHEST_BASE_URL from environment variables automatically.
const behest = new Behest();

export async function POST() {
  // 1. Make sure the user is signed in.
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // 2. Ask Behest for a short-lived token tied to this user.
  //    ttl: 900 = token expires in 15 minutes.
  const result = await behest.auth.mint({
    user_id: session.user.id,
    ttl: 900,
  });

  // 3. Send the token back to the browser.
  //    The browser will use it to call Behest directly.
  return NextResponse.json(result);
}
