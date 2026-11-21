import { redirect } from "next/navigation";
import { DEFAULT_AUTHENTICATED_PATH } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default function AppIndexPage() {
  redirect(DEFAULT_AUTHENTICATED_PATH);
}
