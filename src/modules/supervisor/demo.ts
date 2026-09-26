/**
 * Demo mode
 * =========
 * Same UI and the same real supervisor/worker path, but every step's "model"
 * is a canned, clearly-labelled sample. No gateway call → no ModelRun → no
 * quota. Missions carry `demo: true`, which billing excludes and take-away
 * refuses (no business-data writes).
 */

export const DEMO_PROVIDER = "demo";
export const DEMO_MODEL = "kern-demo（示例数据）";

const NEW_PRODUCT: Record<string, string> = {
  market:
    "## 市场判断（示例）\n- **需求**：25–35 岁城市白领对“低糖 + 高蛋白”零食的搜索量同比 +38%（推断，需二手数据核实）。\n- **竞品**：头部 3 家占线上 52% 份额，价格带 ¥8–15/份。\n- **渠道**：抖音与小红书贡献新品 60% 以上首发声量。\n- **UNKNOWN**：线下便利店复购率。",
  compliance:
    "## 合规边界（示例）\n1. “无糖”宣称需每 100g 糖 ≤ 0.5g（GB 28050）。\n2. 高蛋白宣称需蛋白质 ≥ 12g/100g。\n3. 跨境原料需确认进口检疫。",
  economics:
    "## 单位经济性（示例）\n| 项目 | 假设 |\n|---|---|\n| 目标零售价 | ¥12 |\n| BOM | ¥4.1（假设，需 3 家代工询价） |\n| 目标毛利 | 55% |",
  opportunity:
    "## 候选机会（示例）\n**A. 高蛋白海苔脆（推荐）**：同价位蛋白含量领先约 40%（对照：竞品 X 8g、Y 9g，我们 12.5g）。\n**B. 低糖坚果棒**：红海，差异化弱。\n取舍：A 需要新工艺验证，但窗口期在未来 6–9 个月。",
  validation:
    "## 最小验证计划（示例）\n| 假设 | 方法 | 通过线 | 周期 | 预算 |\n|---|---|---|---|---|\n| 口味被接受 | 盲测 n=60 | 偏好 ≥ 65% | 2 周 | ¥8k |\n| 有人愿意买 | 小红书种草 | CTR ≥ 3% | 3 周 | ¥20k |\n| 能稳定生产 | 小批试产 | 良率 ≥ 92% | 4 周 | ¥30k |",
  gtm:
    "## 上市策略（示例）\n- 首批人群：健身 + 控糖白领\n- 渠道优先级：小红书种草 → 抖音直播 → 天猫旗舰店\n- 冷启动：100 位 KOC 试吃，目标首月 5,000 单\n\n| 阶段 | 时间 | 里程碑 |\n|---|---|---|\n| 验证 | 第 1–4 周 | 盲测 + 种草达标 |\n| 试产 | 第 5–8 周 | 小批 2 万包 |\n| 上市 | 第 9–12 周 | 旗舰店开售 |",
  "red-team":
    "## 红队挑战（示例）\n1. 头部品牌 3 个月内跟进同类 SKU 的概率高。\n2. 海苔原料价格季节波动 ±25%，毛利可能跌破 45%。\n3. “高蛋白”口感差是品类通病，盲测可能失败。",
  synthesis:
    "## 结论：推荐做「高蛋白海苔脆」（示例）\n同价位下蛋白含量领先约 40%，合规路径清楚，窗口期 6–9 个月。\n\n**主要风险**：头部跟进、原料价格波动、口感。\n\n**需要你决定的事**：是否投入约 ¥58k 做为期 4 周的验证（盲测 + 种草 + 小批试产）。",
};

export function demoOutput(nodeKey: string, kind: string, attempt: number): string {
  if (kind === "QA") {
    return JSON.stringify(
      attempt <= 1
        ? {
            verdict: "REVISE",
            summary: "机会判断缺少竞品对照（示例）",
            issues: [{ target: "opportunity", problem: "差异化结论没有给出同价位竞品的蛋白含量对照" }],
          }
        : { verdict: "PASS", summary: "证据边界清楚，可交付（示例）", issues: [] }
    );
  }
  return NEW_PRODUCT[nodeKey] ?? `## ${nodeKey}（示例）\n这是演示模式下的示例产出，不代表真实分析。`;
}

/** Split text into typing-sized chunks (by sentence / line). */
export function chunkForReplay(text: string, target = 60): string[] {
  const parts = text.split(/(?<=[。！？\n])/);
  const out: string[] = [];
  let buf = "";
  for (const p of parts) {
    buf += p;
    if (buf.length >= target) {
      out.push(buf);
      buf = "";
    }
  }
  if (buf) out.push(buf);
  return out;
}

export function demoDelayMs(): number {
  const v = Number(process.env.KERN_DEMO_DELAY_MS);
  if (Number.isFinite(v) && v >= 0) return v;
  return process.env.NODE_ENV === "test" ? 0 : 350;
}
