import assert from "node:assert/strict";
import test from "node:test";
import { parseProse } from "../src/app/muse/components/prose";

test("prose parser: paragraphs, lists, hr, headings", () => {
  const b = parseProse("**我已接手。**\n第二行\n\n- a\n- b\n1. x\n——\n## 结论");
  assert.deepEqual(b.map((x) => x.t), ["p", "ul", "ol", "hr", "h"]);
  assert.equal((b[0] as { lines: string[] }).lines.length, 2);
});
