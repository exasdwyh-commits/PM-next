/**
 * S: 信号雷达 · 信号源注册表 (S/F16)
 *
 * 对齐新版 Evidence 包装口径：每个信号源声明数据性质 (REAL/DEMO) 与核验状态
 * （采集默认 UNVERIFIED）。外部平台 adapter（含蝉妈妈）当前**不真实接入**：
 * mode=manual 的源无自动采集器，采集时跳过绝不虚构；需要真实抓取时由调用方注入
 * collector（测试用 fake collector 验证骨架）。
 */

export type SignalCategory = "opportunity" | "competitor" | "trend" | "policy";

export interface SignalSourceDef {
  key: string;
  name: string;
  category: SignalCategory;
  description: string;
  priority: string; // "P1" | "P2" ...
  /** auto=存在自动采集器；manual=仅人工录入（无收集器则跳过，不伪造） */
  mode: "auto" | "manual";
}

export const SIGNAL_SOURCES: SignalSourceDef[] = [
  {
    key: "chamaix",
    name: "蝉妈妈",
    category: "competitor",
    description: "抖音电商数据（价格带/销量/竞品对标）。当前仅作为人工核验项，未接入真实采集。",
    priority: "P1",
    mode: "manual",
  },
  {
    key: "douyin_trend",
    name: "抖音热榜",
    category: "trend",
    description: "内容趋势信号。当前未接入真实采集。",
    priority: "P2",
    mode: "auto",
  },
  {
    key: "xiaohongshu",
    name: "小红书",
    category: "trend",
    description: "种草/口碑信号。当前未接入真实采集。",
    priority: "P2",
    mode: "auto",
  },
  {
    key: "policy_news",
    name: "行业政策",
    category: "policy",
    description: "备案/法规/监管动态。当前未接入真实采集。",
    priority: "P2",
    mode: "manual",
  },
];

export const SIGNAL_SOURCE_MAP: Record<string, SignalSourceDef> = Object.fromEntries(
  SIGNAL_SOURCES.map((source) => [source.key, source])
);