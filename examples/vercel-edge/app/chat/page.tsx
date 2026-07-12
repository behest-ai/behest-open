import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ChatClient from "@/components/ChatClient";

export default async function ChatPage() {
  const session = await auth();
  if (!session) redirect("/");
  return <ChatClient />;
}
