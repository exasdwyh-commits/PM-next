import { Fragment, type ReactNode } from "react";

/** Minimal, safe Markdown subset for Kern replies (no HTML injection). */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(
      tok.startsWith("**")
        ? <strong key={`${key}-${i++}`}>{tok.slice(2, -2)}</strong>
        : <code key={`${key}-${i++}`}>{tok.slice(1, -1)}</code>
    );
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { t: "p"; lines: string[] }
  | { t: "h"; level: number; text: string }
  | { t: "ul" | "ol"; items: string[] }
  | { t: "hr" };

export function parseProse(src: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of src.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const prev = blocks[blocks.length - 1];
    if (!line.trim()) { blocks.push({ t: "p", lines: [] }); continue; }
    if (/^\s*(——+|---+)\s*$/.test(line)) { blocks.push({ t: "hr" }); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { blocks.push({ t: "h", level: h[1].length, text: h[2] }); continue; }
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (ul) { if (prev?.t === "ul") prev.items.push(ul[1]); else blocks.push({ t: "ul", items: [ul[1]] }); continue; }
    const ol = /^\s*\d+[.、)]\s+(.*)$/.exec(line);
    if (ol) { if (prev?.t === "ol") prev.items.push(ol[1]); else blocks.push({ t: "ol", items: [ol[1]] }); continue; }
    if (prev?.t === "p" && prev.lines.length) prev.lines.push(line);
    else blocks.push({ t: "p", lines: [line] });
  }
  return blocks.filter((b) => !(b.t === "p" && b.lines.length === 0));
}

export function Prose({ text }: { text: string }) {
  const blocks = parseProse(text);
  return (
    <div className="m-prose">
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.t) {
          case "hr": return <hr key={k} />;
          case "h": return <h4 key={k}>{inline(b.text, k)}</h4>;
          case "ul": return <ul key={k}>{b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ul>;
          case "ol": return <ol key={k}>{b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ol>;
          default:
            return <p key={k}>{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l, `${k}-${j}`)}</Fragment>)}</p>;
        }
      })}
    </div>
  );
}
