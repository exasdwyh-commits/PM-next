import type { Confidence } from "./types";
import { sourceAuthorityOf } from "@/shared/vocabulary";

/**
 * 把「来源权威档 + 是否已确认」折算成来源可靠度。
 *
 * 实现已收口到 `@/shared/vocabulary` 的 `sourceAuthorityOf()` —— 这里是保留给
 * muse 这一层的薄封装（旧调用点不必改）。词表的唯一来源是 vocabulary，
 * 本文件不再自带映射表。
 *
 * 为什么上游没给档位时落到 `unrated` 而不是猜一个：
 * 猜出来的「可靠」是假绿标，比老老实实说「未评级」更难被发现。
 */
export function confidenceOf(meta: { authorityTier?: unknown; verified?: unknown }): Confidence {
  return sourceAuthorityOf(meta);
}
