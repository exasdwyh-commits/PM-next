/**
 * HTML → 可读文本。
 *
 * 目标不是「还原排版」，而是让模型能回答问题：标题层级要留（这决定了
 * 「哪一段在讲什么」）、列表与表格要留（它们本身就是结构化答案）、
 * 而导航/脚本/样式要丢（它们只制造噪音）。
 *
 * 用正则而不是 DOM 解析器是有意的：服务端解析不可信 HTML 时，DOM 解析器会
 * 连带做 URL 规范化、字符集嗅探和资源定位等额外行为；这里要的只是抽字，
 * 正则配合褪标签足够，而且不会引入 jsdom 这种体量的依赖。
 */
import type { FileParseOutcome, FileParser, ParserInput } from "../types";

/** 需要先整体摘掉的区块：这些标签里的内容对问答无益或有害。 */
const DROP_BLOCKS = ["script", "style", "noscript", "svg", "iframe", "template", "nav", "footer", "form"];

function stripBlocks(html: string): string {
  let out = html;
  for (const tag of DROP_BLOCKS) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, "gi"), " ");
  }
  // 注释也丢掉：里面常是模板指令、条件 IE hack 与构建器版本号，对问答无益
  return out.replace(/<!--[\s\S]*?-->/g, " ");
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "“",
  rsquo: "”",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** 把块级活跃标签换成换行/符号，让结构在纯文本里还看得出来。 */
function structuralize(html: string): string {
  return html
    .replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_m, tag, inner) => {
      const level = Number(tag.slice(1));
      return `\n\n${"#".repeat(level)} ${inner}\n\n`;
    })
    .replace(/<(li)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, "\n- $2")
    .replace(/<(tr)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, "\n$2")
    .replace(/<(t[dh])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, " | $2 ")
    .replace(/<\/(p|div|section|article|header|ul|ol|table|dl|pre|figure)\s*>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n\n---\n\n");
}

/**
 * `<a>` 只在**携带链接**时保留 `(text)[href]` 形式。
 * 纯锚文本与纯 URL 都丢的信息太多或太少：保留两者才有追问下去的路径。
 */
function keepLinkTargets(html: string): string {
  return html.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, href, inner) => {
    const label = inner.replace(/<[^>]+>/g, "").trim();
    const url = String(href).trim();
    if (label && url && !/^(javascript|data):/i.test(url)) return `${label}（${url}）`;
    return label || url;
  });
}

function pickTitle(html: string): string | undefined {
  const m = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  return m ? collapse(m[1]).trim() || undefined : undefined;
}

function pickDescription(html: string): string | undefined {
  const m = html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
    ?? html.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
  return m ? collapse(decodeEntities(m[1])).trim() || undefined : undefined;
}

/** 把所有空白折叠成单个空格/换行，抹掉缩进带来的假结构。 */
function collapse(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

const htmlParser: FileParser = {
  id: "html",
  label: "网页",
  extensions: [".html", ".htm", ".xhtml"],
  mimeHints: ["text/html"],
  async parse(input: ParserInput): Promise<FileParseOutcome> {
    const raw = input.buffer.toString("utf8").replace(/^\uFEFF/, "");
    const title = pickTitle(raw);
    const description = pickDescription(raw);

    let body = stripBlocks(raw);
    // 先摘 head 里的元数据区，避免 title/description 在正文里重复出现
    body = body.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, " ");
    body = keepLinkTargets(body);
    body = structuralize(body);
    body = collapse(body);
    body = decodeEntities(body).trim();

    const text = [
      title ? `# ${title}` : null,
      description ? `页面摘要：${description}` : null,
      body,
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      status: "READY",
      kind: "html",
      text,
      meta: {
        ...(title ? { headings: [title] } : {}),
        rowCount: body.split(/\r?\n/).length,
      },
      note: "已剔除脚本、样式与导航区块；保留标题层级、列表与表格的行列分隔。",
    };
  },
};

export { htmlParser };
