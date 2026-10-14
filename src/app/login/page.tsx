import { headers } from "next/headers";
import LoginClient from "./login-client";
import { isPrivateHost, localTestLoginEnabled } from "@/modules/identity/local-test-policy";

export const dynamic = "force-dynamic";

/**
 * 本地测试模式的登录提示：账号 + 口令从环境（SEED_PASSWORD）取，不写进源码。
 *
 * 只在「NODE_ENV 非 production + 请求来自本机/内网」时传入（比免密入口多覆盖
 * 纯 npm run dev 场景）；生产环境、公网 Host 或环境里没有 SEED_PASSWORD 时
 * 恒为 null，页面不会出现凭据。
 */
function localTestHint(): { email: string; password: string } | null {
  const password = process.env.SEED_PASSWORD?.trim();
  if (!password) return null;
  return { email: process.env.KERN_DEMO_EMAIL?.trim() || "zhang_pm@hermes.test", password };
}

export default async function LoginPage() {
  const headerList = await headers();
  const host = headerList.get("host");
  const localTestLogin = localTestLoginEnabled(host);
  const showTestHint = process.env.NODE_ENV !== "production" && !!host && isPrivateHost(host);
  return <LoginClient localTestLogin={localTestLogin} testHint={showTestHint ? localTestHint() : null} />;
}
