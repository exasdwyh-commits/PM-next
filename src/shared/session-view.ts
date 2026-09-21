import type { SessionContext } from "@/modules/identity/session";

/**
 * 会话视图（Phase 3A · B6）
 *
 * RSC 页面此前用 `JSON.parse(JSON.stringify(session))` 把整个 SessionContext
 * 下发到客户端，其中包含 `sessionId`（会话行 id）——属于实现细节，UI 并不需要。
 * 这里改为**显式白名单**：新字段默认不会自动外发。
 *
 * 参考：客户端实际使用的字段只有 userId / userName / userEmail
 * （见 workbench-client.tsx:92,172、project-detail-client.tsx:34 等）。
 */
export interface SessionView {
  userId: string;
  organizationId: string;
  userEmail: string;
  userName: string;
}

export function toSessionView(session: SessionContext): SessionView {
  return {
    userId: session.userId,
    organizationId: session.organizationId,
    userEmail: session.userEmail,
    userName: session.userName,
  };
}
