/**
 * Role Preference Memory
 * ======================
 * 记住用户的角色偏好，让 Kern 越用越懂你
 * 
 * 存储格式：PREFERENCE 类型的记忆，内容包含角色信息
 * 例如："用户偏好角色：销售营销 (sales)，原因是经常问卖点和客户话术"
 */

import { KernMemoryKind } from "@prisma/client";
import type { SessionContext } from "@/modules/identity/session";
import { rememberForUser, listMemories, extractTopics } from "./index";
import type { UserRole } from "@/modules/assistant-runtime/role-intelligence";

const ROLE_PREFERENCE_PREFIX = "用户偏好角色：";
const ROLE_KEYWORDS: Record<UserRole, string[]> = {
  leadership: ["领导", "老板", "管理层", "直观"],
  product: ["产品", "研发", "技术", "工程师", "专业"],
  sales: ["销售", "营销", "卖点", "客户", "市场"],
  operator: ["操盘手", "排期", "节奏", "甘特", "里程碑", "卡点", "SLA", "漏斗"],
};

export function parseRoleFromMemory(content: string): UserRole | null {
  const lower = content.toLowerCase();
  if (lower.includes("leadership") || lower.includes("领导") || lower.includes("老板")) {
    // Check if it's explicitly about role preference
    if (content.includes("偏好角色") || content.includes("角色") || content.includes("视角")) {
      if (ROLE_KEYWORDS.leadership.some(k => content.includes(k))) return "leadership";
    }
  }
  if (content.includes("sales") || content.includes("销售") || content.includes("营销")) {
    if (content.includes("偏好角色") || content.includes("角色") || content.includes("视角") || content.includes("卖点")) {
      return "sales";
    }
  }
  if (content.includes("product") || content.includes("产品") || content.includes("研发")) {
    if (content.includes("偏好角色") || content.includes("角色") || content.includes("视角") || content.includes("证据")) {
      return "product";
    }
  }
  if (content.includes("operator") || content.includes("操盘") || content.includes("排期") || content.includes("甘特")) {
    if (content.includes("偏好角色") || content.includes("角色") || content.includes("视角") || content.includes("节奏")) {
      return "operator";
    }
  }
  // Direct role mention
  if (content.includes("用户偏好角色：")) {
    if (content.includes("领导") || content.includes("leadership")) return "leadership";
    if (content.includes("销售") || content.includes("sales") || content.includes("营销")) return "sales";
    if (content.includes("产品") || content.includes("product") || content.includes("研发")) return "product";
    if (content.includes("操盘") || content.includes("operator") || content.includes("排期")) return "operator";
  }
  return null;
}

export function buildRolePreferenceContent(role: UserRole, reason?: string): string {
  const roleLabel = {
    leadership: "领导层 (leadership) - 直观看的懂，一页看懂结论",
    product: "产品研发 (product) - 专业严谨，可信度第一",
    sales: "销售营销 (sales) - 卖点突出，销售支撑",
    operator: "操盘手 (operator) - 节奏优先，排期卡点一目了然",
  }[role];

  const base = `${ROLE_PREFERENCE_PREFIX}${roleLabel}`;
  if (reason) {
    return `${base}，原因：${reason.slice(0, 100)}`;
  }
  return base;
}

export async function rememberRolePreference(
  session: SessionContext,
  role: UserRole,
  reason?: string
) {
  const content = buildRolePreferenceContent(role, reason);
  return rememberForUser(session, {
    kind: KernMemoryKind.PREFERENCE,
    content,
    pinned: true,
    topics: ["角色偏好", "role", role, ...(reason ? extractTopics(reason) : [])],
    source: `role-preference:${role}`,
  });
}

export async function recallRolePreference(
  session: SessionContext
): Promise<{ role: UserRole; content: string; confidence: number } | null> {
  const memories = await listMemories(session, 100);
  const roleMemories = memories
    .filter(m => m.kind === KernMemoryKind.PREFERENCE && m.content.includes("偏好角色"))
    .map(m => ({
      memory: m,
      role: parseRoleFromMemory(m.content),
    }))
    .filter((x): x is { memory: typeof x.memory; role: UserRole } => !!x.role)
    .sort((a, b) => b.memory.createdAt.getTime() - a.memory.createdAt.getTime());

  if (roleMemories.length === 0) return null;

  // Most recent wins, but if multiple same role, boost confidence
  const mostRecent = roleMemories[0];
  const sameRoleCount = roleMemories.filter(r => r.role === mostRecent.role).length;
  const confidence = Math.min(0.95, 0.5 + sameRoleCount * 0.15);

  return {
    role: mostRecent.role,
    content: mostRecent.memory.content,
    confidence,
  };
}

export function detectRolePreferenceIntent(text: string): UserRole | null {
  const lower = text.toLowerCase();
  // "记住我喜欢销售视角" "以后默认用领导视角" "我通常是产品角色"
  const patterns: { pattern: RegExp; role: UserRole }[] = [
    { pattern: /(记住|记一下).{0,10}(我|用户).{0,10}(喜欢|偏好|常用|通常).{0,10}(领导|老板|直观)/i, role: "leadership" },
    { pattern: /(记住|记一下).{0,10}(我|用户).{0,10}(喜欢|偏好|常用|通常).{0,10}(产品|研发|技术)/i, role: "product" },
    { pattern: /(记住|记一下).{0,10}(我|用户).{0,10}(喜欢|偏好|常用|通常).{0,10}(销售|营销|卖点)/i, role: "sales" },
    { pattern: /(记住|记一下).{0,10}(我|用户).{0,10}(喜欢|偏好|常用|通常).{0,10}(操盘|运营|排期|甘特|节奏)/i, role: "operator" },
    { pattern: /(以后|今后|默认).{0,10}(用|切|显示).{0,10}(领导|老板|直观)/i, role: "leadership" },
    { pattern: /(以后|今后|默认).{0,10}(用|切|显示).{0,10}(产品|研发|技术)/i, role: "product" },
    { pattern: /(以后|今后|默认).{0,10}(用|切|显示).{0,10}(销售|营销|卖点)/i, role: "sales" },
    { pattern: /(以后|今后|默认).{0,10}(用|切|显示).{0,10}(操盘|运营|排期|甘特|节奏)/i, role: "operator" },
    { pattern: /我是(做)?(领导|老板|管理层)/i, role: "leadership" },
    { pattern: /我是(做)?(产品|研发|技术|工程师)/i, role: "product" },
    { pattern: /我是(做)?(销售|营销|市场)/i, role: "sales" },
    { pattern: /我是(做)?(操盘手|运营|项目管理|pm)/i, role: "operator" },
  ];

  for (const { pattern, role } of patterns) {
    if (pattern.test(text)) return role;
  }
  return null;
}
