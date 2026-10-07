import { test } from "node:test";
import assert from "node:assert/strict";
import { parseToolCall } from "../src/modules/supervisor/tools";

test("原生 kern-tool 围栏", () => {
  assert.deepEqual(parseToolCall('```kern-tool\n{"tool":"knowledge_search","input":{"query":"燕麦"}}\n```'), { tool: "knowledge_search", input: { query: "燕麦" } });
});

test("MiMo/Qwen XML：function=工具名 + parameter", () => {
  const t = "<tool_call>\n<function=knowledge_search>\n<parameter=query>\n高蛋白 燕麦脆\n</parameter>\n</function>\n</tool_call>";
  assert.deepEqual(parseToolCall(t), { tool: "knowledge_search", input: { query: "高蛋白 燕麦脆" } });
});

test("XML：function=kern-tool 包裹 tool/input", () => {
  const t = '<tool_call><function=kern-tool><parameter=tool>calc</parameter><parameter=input>{"expr":"1+2"}</parameter></function></tool_call>';
  assert.deepEqual(parseToolCall(t), { tool: "calc", input: { expr: "1+2" } });
});

test("XML：function=kern-tool 内为 JSON", () => {
  const t = '<tool_call><function=kern-tool>{"tool":"calc","input":{"expr":"2"}}</function></tool_call>';
  assert.deepEqual(parseToolCall(t), { tool: "calc", input: { expr: "2" } });
});

test("<tool_call> 内为 JSON（name/arguments）", () => {
  assert.deepEqual(parseToolCall('<tool_call>{"name":"calc","arguments":{"expr":"3"}}</tool_call>'), { tool: "calc", input: { expr: "3" } });
});

test("无围栏 kern-tool 标签 + JSON", () => {
  assert.deepEqual(parseToolCall('kern-tool\n{"tool":"calc","input":{"expr":"4"}}'), { tool: "calc", input: { expr: "4" } });
});

test("普通结论不误判", () => {
  assert.equal(parseToolCall("## 结论\n建议先做华东渠道，kern-tool 已不再需要。"), null);
});
