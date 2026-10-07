import { headers } from "next/headers";
import LoginClient from "./login-client";
import { localTestLoginEnabled } from "@/modules/identity/local-test-policy";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const headerList = await headers();
  return <LoginClient localTestLogin={localTestLoginEnabled(headerList.get("host"))} />;
}
