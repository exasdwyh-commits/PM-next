/**
 * 来源标题格式化：把「文档标题 + 标题路径」拼成一条**不重复**的可读标题。
 *
 * 切片器（sync.ts `chunkMarkdownByHeadings`）产出的 `headingPath` 里**已经包含文档标题**，
 * 且当文档的首个一级标题与文档标题同名时还会再重复一次。旧写法
 * `docTitle + " > " + headingPath` 于是拼出「文档名 > 文档名 > 文档名 > 章节」——
 * 既难读，又长到挤爆对话里的「来源与回执」行（实测见 `.diag/m-src-overflow.mjs`）。
 *
 * 收口在这里（而不是散在 router / capabilities / advisor 三处手拼），避免再次分叉。
 * 零依赖，供任意层引用。
 */
export function sourceTitle(
  docTitle: string | null | undefined,
  headingPath: string | null | undefined
): string {
  const doc = (docTitle ?? "").trim();
  const segs = (headingPath ?? "")
    .split(">")
    .map((s) => s.trim())
    .filter(Boolean);

  const parts: string[] = [];
  for (const seg of segs) {
    if (parts.length && parts[parts.length - 1] === seg) continue; // 折叠相邻重复
    if (!parts.length && seg === doc) continue; // 首段若等于文档标题则省去
    parts.push(seg);
  }

  if (!parts.length) return doc;
  if (parts[0] === doc) return parts.join(" > ");
  return doc ? [doc, ...parts].join(" > ") : parts.join(" > ");
}
