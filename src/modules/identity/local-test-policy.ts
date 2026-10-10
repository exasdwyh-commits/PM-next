// The launch script also binds the server to 127.0.0.1; hostname checks alone
// cannot establish that a request came from the local machine.
export const LOCAL_TEST_EMAIL = "local-test@kern.invalid";

/**
 * 局域网测试账号所属组织。
 *
 * ⚠️ 这个值决定**测试账号能看到什么**，改错会让整个演示不可用：
 * 2026-10-10 实测踩过——原先默认 `KERN_LOCAL_TEST` 是登录时**新建的空组织**，
 * 而 13 个 agent、12 个模型 profile、16 条策略全在 `HERMES_FOOD_DEV`。
 * 结果登录后任务准备度检查全红：
 *   · 「计划所需团队成员未初始化或已停用」← 该组织 0 个 agent
 *   · 「部分步骤没有符合策略的已配置模型」← 该组织 0 个 profile/policy
 *
 * 故默认复用**有完整演示数据的组织**。部署到别处时用
 * `KERN_LOCAL_TEST_ORG_CODE` 指定自己的组织 code，不要指向空组织。
 */
export const LOCAL_TEST_ORG = process.env.KERN_LOCAL_TEST_ORG_CODE?.trim() || "HERMES_FOOD_DEV";
export const LOCAL_TEST_SESSION_DAYS = 30;

/**
 * 局域网免密入口（角色即登录）。
 *
 * 适用场景：内网多人试用，**不做账号密码**——进页面选一个角色就直接进。
 * 每个人共用该角色的本地测试账号；个性（视角角色 / 使用偏好）由浏览器侧的
 * role-context 存储，不依赖账号区分。
 *
 * ⚠️ 安全边界（这不是漏洞，是本模式的**前提**）：
 * 任何能访问到本服务端口的人都能进入。因此仅在以下条件同时满足时启用——
 *   1. NODE_ENV=development（生产环境一律拒绝，路由层还会 FATAL_SECURITY_MISCONFIG）；
 *   2. KERN_LOCAL_TEST_LOGIN=true；
 *   3. 请求来自**本机或内网网段**（见 isPrivateHost）。
 *
 * 外网暴露时务必关掉 KERN_LOCAL_TEST_LOGIN 并改用正式密码登录。
 */
export function localTestLoginEnabled(host: string | null): boolean {
  if (process.env.NODE_ENV !== "development" || process.env.KERN_LOCAL_TEST_LOGIN !== "true" || !host) return false;
  return isPrivateHost(host);
}

/** 同源 + 非跨站请求，避免任意站点替用户触发免密进入。 */
export function localTestRequestAllowed(headers: { get(name: string): string | null }): boolean {
  const host = headers.get("host");
  if (!localTestLoginEnabled(host) || headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = headers.get("origin");
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && url.host === host && url.origin === origin;
  } catch {
    return false;
  }
}

/**
 * 允许的回环与私有网段主机：localhost / 127.0.0.0/8 / ::1 / 10.x /
 * 172.16-31.x / 192.168.x。解析失败一律拒绝（不放开未知形态，避免误判）。
 *
 * 注意：这里刻意**只认 IPv4 私有段 + 回环**，不认 IPv6 ULA（fc00::/7）——
 * 内网部署实测用的是 192.168.x.x，放开 IPv6 反而扩大免密来源面。
 */
export function isPrivateHost(host: string): boolean {
  const hostname = hostToHostname(host);
  if (!hostname) return false;
  if (hostname === "localhost" || hostname === "::1" || hostname === "[::1]") return true;
  const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function hostToHostname(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

/**
 * 角色 → 账号。选角色即用该角色的常驻账号，便于在 session / 审计里
 * 一眼看出「谁以什么视角进来」。
 *
 * ⚠️ `LOCAL_TEST_EMAIL`（local-test@）**必须继续存在** —— 有 3 个脚本
 * （accept-local-conclusion-choice / accept-local-metaso-research /
 * configure-local-live-models）用 `findUniqueOrThrow` 按它取用户。
 * 角色账号是**新增**的旁路，不是替换。
 */
export const LOCAL_TEST_ROLE_EMAILS: Record<string, string> = {
  leadership: "local-leadership@kern.invalid",
  product: "local-product@kern.invalid",
  sales: "local-sales@kern.invalid",
};

export const DEFAULT_LOCAL_TEST_ROLE = "leadership";

/**
 * 把「客户端传来的 role」解析成一个**必定存在或可创建**的账号 email。
 *
 * ⚠️ 不能让客户端直接传 email —— 那等于把任意 email 变成可登录账号。
 * 这里只接受白名单里的角色键，其余（含非法值）一律落到 local-test@。
 */
export function emailForRole(role: string | null | undefined): string {
  const key = (role ?? "").trim();
  if (Object.hasOwn(LOCAL_TEST_ROLE_EMAILS, key)) return LOCAL_TEST_ROLE_EMAILS[key];
  return LOCAL_TEST_EMAIL;
}