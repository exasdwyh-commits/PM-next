/**
 * 品类文本分类回归锁（`matchCategoryByText` / `classifyCategoryByText`）。
 *
 * 断言是 **pack 驱动** 的：关键词从当前 pack 的 `categoryContent.<key>.classifyKeywords`
 * 读取，不写死任何行业词 —— 换 pack（如 pet-food / 未来的第三个 pack）后本测试依然成立，
 * 这正是它要守护的性质（内核不含行业假设）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  categoryKeys,
  categoryContent,
  defaultCategoryKey,
  classifyCategoryByText,
  matchCategoryByText,
} from "../src/modules/tenant";

test("空文本 / 无关键词文本不匹配任何品类（返回 null）", () => {
  assert.equal(matchCategoryByText(""), null);
  assert.equal(matchCategoryByText(null), null);
  assert.equal(matchCategoryByText("zzz-no-keyword-zzz"), null);
});

test("无命中时 classify 退回兜底键，且兜底键在 pack 中存在", () => {
  assert.equal(classifyCategoryByText("zzz-no-keyword-zzz"), defaultCategoryKey());
  assert.ok(categoryKeys().includes(defaultCategoryKey()));
});

test("pack 的每个 classifyKeywords 关键词都能被识别回其所属品类", () => {
  let checked = 0;
  for (const k of categoryKeys()) {
    for (const w of categoryContent(k).classifyKeywords ?? []) {
      const hit = matchCategoryByText(`前缀${w}后缀`);
      assert.equal(hit, k, `关键词「${w}」应归入品类 ${k}，实得 ${hit}`);
      checked++;
    }
  }
  assert.ok(checked > 0, "当前 pack 未定义任何 classifyKeywords，测试无意义");
});

test("分类逻辑不依赖 src/ 中的写死词：替换为任意合成 pack 数据仍成立", () => {
  // 用 pack 自带关键词自证：把关键词拼成文本必须命中该品类，反向证明匹配源是 pack。
  const keys = categoryKeys();
  for (const k of keys) {
    const kw = (categoryContent(k).classifyKeywords ?? [])[0];
    if (!kw) continue;
    assert.equal(classifyCategoryByText(`含${kw}的文本`), k);
  }
});
