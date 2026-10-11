"use client";

import { useEffect } from "react";

/** Report actions stay in the browser; report content remains server rendered. */
export function ReportToolbar() {
  useEffect(() => {
    let closed: HTMLDetailsElement[] = [];
    const prepare = () => {
      closed = Array.from(document.querySelectorAll<HTMLDetailsElement>(".rp-sheet details:not([open])"));
      closed.forEach((detail) => { detail.open = true; });
    };
    const restore = () => {
      closed.forEach((detail) => { detail.open = false; });
      closed = [];
    };
    window.addEventListener("beforeprint", prepare);
    window.addEventListener("afterprint", restore);
    return () => {
      window.removeEventListener("beforeprint", prepare);
      window.removeEventListener("afterprint", restore);
      restore();
    };
  }, []);

  return (
    <div className="rp-toolbar rp-wrap">
      <a className="rp-brand" href="/muse" aria-label="返回 Kern 对话">Kern<span>报告</span></a>
      <div className="rp-toolbar-actions">
        <a href="#report-sources">查看来源</a>
        <button type="button" onClick={() => window.print()}>打印 / 存为 PDF</button>
      </div>
    </div>
  );
}
