// 证据核实环：三种口径的**实际渲染产物**（SSR markup）对照。
// 与 product-overview-client.tsx 验证页签所传 props 完全一致（见源码守卫 6b）。临时脚本，不提交。
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgressRing } from "../src/components/viz";

(globalThis as any).React = React;

function page(total: number, verifiedReal: number) {
  return React.createElement(ProgressRing, {
    value: total > 0 ? Math.round((verifiedReal / total) * 100) : null,
    valueText: total > 0 ? `${verifiedReal}/${total} 已核实` : undefined,
    label: "证据核实",
    caption:
      total > 0
        ? `已核实真实依据 ${verifiedReal} 条 / 依据总数 ${total} 条；未核实与演示数据不计入分子。`
        : "暂无依据可核实（依据总数 0 条）。待补证后再评估已核实占比。",
    tone: verifiedReal > 0 ? "ok" : "neutral",
  });
}

for (const [t, v] of [[0, 0], [12, 0], [12, 3]] as const) {
  const html = renderToStaticMarkup(page(t, v));
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const pAttr = (html.match(/--p:\s*(\d+)/) || [])[1];
  console.log(`\n--- total=${t}  verifiedReal=${v} ---`);
  console.log("  可见文本：", text);
  console.log(
    "  环角度 --p=" + pAttr,
    "| data-empty=" + /data-empty="true"/.test(html),
    "| data-display=" + ((html.match(/data-display="([^"]+)"/) || [])[1] ?? "(none)"),
    "| data-tone=" + ((html.match(/data-tone="([^"]+)"/) || [])[1] ?? "(none)"),
    "| 含任何 %：" + html.includes("%"),
  );
  console.log("  HTML：", html.replace(/\s+/g, " "));
}
