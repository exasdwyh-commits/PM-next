/**
 * 公司身份层（SOUL.md）的运行时加载。
 *
 * 此前 SOUL.md 只是 pack 里的一个死文件：写了「为谁服务、关注什么」，但没有任何
 * 代码读它，助理的自我认知与部署方无关。这里把它接到 ASSISTANT_* 人格上——
 * 「先解决成为谁，再解决回答什么」。
 *
 * 三条刻意的约束：
 *  1. **仅服务端**。用 fs 读文件，绝不能进客户端包，所以不放进 tenant/registry.ts
 *     （那个文件被客户端组件引用）。
 *  2. **缺失即回落**。读不到就返回 null，人格与今天完全一致，不抛错、不挡对话。
 *     注意 next.config.ts 只设了 distDir，packs/ 不是打包资源：standalone 产物
 *     可能不含 packs/，那时就是 null——这是有意的降级，不是静默失败。
 *  3. **内容是外部输入**。SOUL.md 由部署方编辑却要进 system prompt，属于注入面：
 *     这里只做读取与清洗，加框与限长交给 persona.ts（纯函数，可单测）。
 */
import fs from "node:fs";
import path from "node:path";
import { resolveTenantPackId } from "./index";

/** pack id 来自环境变量，直接拼路径就是目录穿越，先过白名单。 */
const SAFE_PACK_ID = /^[a-z0-9][a-z0-9._-]*$/;

const cache = new Map<string, string | null>();

/**
 * 只留正文：`>` 开头的是写给维护者看的元注释（例如「本文件当前未注入」），
 * 让它们进 prompt 只会误导模型。
 */
export function sanitizeSoulMarkdown(raw: string): string {
  return raw
    .split(/\r?\n/)
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 读取当前（或指定）租户包的身份层；不存在、不可读、被清空后为空 → null。 */
export function loadTenantSoul(id: string = resolveTenantPackId()): string | null {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;

  let soul: string | null = null;
  if (SAFE_PACK_ID.test(id)) {
    try {
      const raw = fs.readFileSync(path.join(process.cwd(), "packs", id, "SOUL.md"), "utf8");
      soul = sanitizeSoulMarkdown(raw) || null;
    } catch {
      soul = null; // 没有身份层是合法状态：回落到通用 Kern 人设。
    }
  }
  cache.set(id, soul);
  return soul;
}

/** 测试与热更用：清掉进程内缓存。 */
export function clearTenantSoulCache(): void {
  cache.clear();
}
