/**
 * 客户端身份头工具。
 *
 * 只在服务端明确告知「开发态免密身份可用」时，才附带 `x-user-id`。
 * 正式会话以 httpOnly cookie 为准；带 cookie 的同时再发 `x-user-id`
 * 会被生产环境的会话校验直接拒绝（403），因此禁止无条件附带。
 */
export function identityHeaders(
  mockAuthEnabled: boolean,
  userId: string | null | undefined,
  extra?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  if (mockAuthEnabled && userId) {
    headers["x-user-id"] = userId;
  }
  return headers;
}

/** 身份切换下拉是否应当出现（仅开发态） */
export function showIdentitySwitcher(mockAuthEnabled: boolean): boolean {
  return mockAuthEnabled;
}
