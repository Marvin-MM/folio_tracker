import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DEFAULT_AUTHENTICATED_PATH } from "@/lib/constants";
import { auth } from "@/server/auth";

export default async function HomePage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (session) {
    redirect(DEFAULT_AUTHENTICATED_PATH);
  }

  redirect("/login");
}
