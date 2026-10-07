/**
 * KX-30 凭证保管层 · 服务
 * =======================
 *
 * 规则（与 protected-actions 的 CREDENTIAL_USE_OR_DISCLOSURE 对应）：
 * - **披露**：没有任何接口返回明文或密文；列表只给 header 名 + 末 4 位。
 * - **使用**：只有服务端调用方（工具 / 连接器）能通过 `injectCredential` 取到 header；
 *   用户录入一条凭证即授权 Kern 在「该目标」上使用它，跨目标使用一律拒绝。
 *   每次使用都写审计（谁、为什么、给哪个主机）。一次性凭证用条件更新保证只能用一次。
 * - 录入走专门表单（/api/vault），不经过聊天，也不进入模型上下文。
 */
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { randomUUID } from "node:crypto";
import { AppError, UnprocessableEntityError } from "@/shared/errors";
import {
  VAULT_LIMITS,
  VaultConfigError,
  credentialStatus,
  decryptSecret,
  encryptSecret,
  headerHint,
  loadVaultKey,
  normalizeTarget,
  targetMatches,
  validateHeaders,
  type CredentialStatus,
  type HeaderPair,
} from "./crypto";

export * from "./crypto";

export type CredentialView = {
  id: string;
  target: string;
  label: string;
  hint: string;
  oneTime: boolean;
  expiresAt: string | null;
  status: CredentialStatus;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  devKey: boolean;
};

type Owner = Pick<SessionContext, "userId" | "organizationId">;

const aadOf = (c: { id: string; userId: string; target: string }) => `${c.userId}|${c.target}|${c.id}`;

function key() {
  try {
    return loadVaultKey();
  } catch (e) {
    if (e instanceof VaultConfigError) throw new AppError(e.message, "VAULT_NOT_CONFIGURED", 503);
    throw e;
  }
}

type Row = {
  id: string;
  target: string;
  label: string;
  hint: string;
  oneTime: boolean;
  expiresAt: Date | null;
  usedAt: Date | null;
  revokedAt: Date | null;
  useCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  keyVersion: number;
};

function view(r: Row): CredentialView {
  return {
    id: r.id,
    target: r.target,
    label: r.label,
    hint: r.hint,
    oneTime: r.oneTime,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    status: credentialStatus(r),
    useCount: r.useCount,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    devKey: r.keyVersion === 0,
  };
}

const SAFE_SELECT = {
  id: true, target: true, label: true, hint: true, oneTime: true, expiresAt: true, usedAt: true,
  revokedAt: true, useCount: true, lastUsedAt: true, createdAt: true, keyVersion: true,
} as const;

export async function listCredentials(session: Owner): Promise<CredentialView[]> {
  const rows = await prisma.kernCredential.findMany({
    where: { userId: session.userId, organizationId: session.organizationId },
    orderBy: { createdAt: "desc" },
    select: SAFE_SELECT,
    take: 200,
  });
  return rows.map(view);
}

export type CreateCredentialInput = { target: string; label?: string; headers: HeaderPair[]; ttlSeconds?: number | null; oneTime?: boolean };

export async function createCredential(session: Owner, input: CreateCredentialInput): Promise<CredentialView> {
  const target = normalizeTarget(input.target ?? "");
  if (!target) throw new UnprocessableEntityError("目标必须是域名（如 api.example.com、*.example.com）或 connector:<id>");
  const headers = (input.headers ?? []).map((h) => ({ name: String(h?.name ?? "").trim(), value: String(h?.value ?? "") }));
  const bad = validateHeaders(headers);
  if (bad) throw new UnprocessableEntityError(bad);
  const ttl = input.ttlSeconds == null ? null : Number(input.ttlSeconds);
  if (ttl !== null && (!Number.isFinite(ttl) || ttl < 60 || ttl > VAULT_LIMITS.maxTtlSeconds)) {
    throw new UnprocessableEntityError("有效期需在 1 分钟到 90 天之间");
  }
  const label = (input.label ?? "").trim().slice(0, VAULT_LIMITS.maxLabelChars) || target;
  const k = key();
  const id = randomUUID();
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.kernCredential.create({
      data: {
        id,
        organizationId: session.organizationId,
        userId: session.userId,
        target,
        label,
        hint: headerHint(headers),
        cipher: encryptSecret(JSON.stringify(headers), k, aadOf({ id, userId: session.userId, target })),
        keyVersion: k.version,
        oneTime: input.oneTime === true,
        expiresAt: ttl ? new Date(Date.now() + ttl * 1000) : null,
      },
      select: SAFE_SELECT,
    });
    await tx.auditEvent.create({
      data: {
        actorId: session.userId,
        action: "credential.create",
        objectType: "KernCredential",
        objectId: id,
        summary: `保管凭证：${label}（${target}）`,
        details: { target, headerNames: headers.map((h) => h.name), oneTime: created.oneTime, ttlSeconds: ttl },
      },
    });
    return created;
  });
  return view(row);
}

export async function revokeCredential(session: Owner, id: string): Promise<boolean> {
  const res = await prisma.kernCredential.updateMany({
    where: { id, userId: session.userId, organizationId: session.organizationId, revokedAt: null },
    data: { revokedAt: new Date(), cipher: "" },
  });
  if (res.count === 0) {
    const exists = await prisma.kernCredential.count({ where: { id, userId: session.userId, organizationId: session.organizationId } });
    return exists > 0;
  }
  await prisma.auditEvent.create({
    data: { actorId: session.userId, action: "credential.revoke", objectType: "KernCredential", objectId: id, summary: "撤销凭证（密文已清除）" },
  });
  return true;
}

export type CredentialUse = { credentialId: string; headers: Record<string, string>; secrets: string[] };

/**
 * 服务端注入入口：为某个主机 / 连接器取出匹配的凭证 header。
 * 只返回给调用方代码，调用方必须用 `redactSecrets(output, use.secrets)` 处理回显。
 * 找不到可用凭证时返回 null（由调用方决定是否向用户提问）。
 */
export async function injectCredential(
  owner: Owner,
  req: { host: string; purpose: string; credentialId?: string; missionTaskId?: string | null }
): Promise<CredentialUse | null> {
  const host = req.host.trim().toLowerCase();
  const purpose = req.purpose.trim().slice(0, 200);
  if (!purpose) throw new UnprocessableEntityError("使用凭证必须写明用途");
  const now = new Date();
  const rows = await prisma.kernCredential.findMany({
    where: {
      userId: owner.userId,
      organizationId: owner.organizationId,
      revokedAt: null,
      ...(req.credentialId ? { id: req.credentialId } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
  });
  const hit = rows.find((r) => credentialStatus(r, now) === "ACTIVE" && targetMatches(r.target, host));
  if (!hit) {
    if (req.credentialId && rows.length) {
      await prisma.auditEvent.create({
        data: { actorId: owner.userId, action: "credential.deny", objectType: "KernCredential", objectId: req.credentialId, summary: `拒绝跨目标使用凭证：${host}`, details: { host, purpose } },
      });
    }
    return null;
  }
  const claimed = await prisma.kernCredential.updateMany({
    where: { id: hit.id, revokedAt: null, ...(hit.oneTime ? { usedAt: null } : {}) },
    data: { useCount: { increment: 1 }, lastUsedAt: now, ...(hit.oneTime ? { usedAt: now } : {}) },
  });
  if (claimed.count === 0) return null; // 并发下一次性凭证已被用掉
  const k = key();
  const pairs = JSON.parse(decryptSecret(hit.cipher, k, aadOf(hit))) as HeaderPair[];
  await prisma.auditEvent.create({
    data: {
      actorId: owner.userId,
      action: "credential.use",
      objectType: "KernCredential",
      objectId: hit.id,
      summary: `使用凭证「${hit.label}」访问 ${host}：${purpose}`,
      details: { host, purpose, missionTaskId: req.missionTaskId ?? null, headerNames: pairs.map((p) => p.name), oneTime: hit.oneTime },
    },
  });
  return {
    credentialId: hit.id,
    headers: Object.fromEntries(pairs.map((p) => [p.name, p.value])),
    secrets: pairs.map((p) => p.value),
  };
}
