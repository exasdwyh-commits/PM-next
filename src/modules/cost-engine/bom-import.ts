/**
 * BOM 导入与规整（本地补齐）
 * --------------------------
 * Arena 工作区未交付本文件（cost-export.tsx 从它取 `BomItem` 类型）。
 * 字段按调用点固定：name / quantity / unit / unitPrice / cost / supplier?
 * 解析能力按 MASTER_PLAN_4CAT.md「BOM：可编辑表格+CSV导入+模板+用量单价成本+供应商+规格+警告」实现
 * —— 只做 CSV/TSV 文本解析，不做 xlsx 二进制解析（避免引入新依赖）。
 */

export interface BomItem {
  name: string;
  /** 用量（单件耗用） */
  quantity: number;
  /** 用量单位：g / ml / 个 / 张… */
  unit: string;
  /** 单价（元/单位） */
  unitPrice: number;
  /** 单件成本 = quantity × unitPrice，四舍五入到分 */
  cost: number;
  supplier?: string;
  /** 规格，如「25kg/袋」 */
  spec?: string;
  /** 校验告警：用量或单价异常时给出提示 */
  warnings?: string[];
}

const HEADER_ALIASES: Record<string, keyof BomItem> = {
  名称: "name",
  物料: "name",
  原料: "name",
  name: "name",
  用量: "quantity",
  数量: "quantity",
  quantity: "quantity",
  单位: "unit",
  unit: "unit",
  单价: "unitPrice",
  价格: "unitPrice",
  unitprice: "unitPrice",
  金额: "cost",
  成本: "cost",
  cost: "cost",
  供应商: "supplier",
  supplier: "supplier",
  规格: "spec",
  spec: "spec",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 单件成本由用量×单价推导，不由输入直接采信（避免表格里填错金额）。 */
export function withComputedCost(item: Omit<BomItem, "cost"> & Partial<Pick<BomItem, "cost">>): BomItem {
  const quantity = Number(item.quantity) || 0;
  const unitPrice = Number(item.unitPrice) || 0;
  const warnings: string[] = [];
  if (quantity <= 0) warnings.push("用量为 0 或缺失");
  if (unitPrice <= 0) warnings.push("单价为 0 或缺失");

  return {
    ...item,
    quantity,
    unitPrice,
    cost: round2(quantity * unitPrice),
    warnings: warnings.length ? warnings : undefined,
  };
}

/**
 * 解析 CSV / TSV 文本为 BOM 清单。
 * 支持中英文表头（见 HEADER_ALIASES），缺少表头时按
 * `名称,用量,单位,单价,供应商,规格` 的列序解析。
 */
export function parseBomCsv(text: string): { items: BomItem[]; errors: string[] } {
  const errors: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return { items: [], errors: ["内容为空"] };

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const split = (line: string) => line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ""));

  const first = split(lines[0]);
  const looksLikeHeader = first.some((c) => HEADER_ALIASES[c.toLowerCase()] !== undefined);
  const columns: Array<keyof BomItem | undefined> = looksLikeHeader
    ? first.map((c) => HEADER_ALIASES[c.toLowerCase()])
    : (["name", "quantity", "unit", "unitPrice", "supplier", "spec"] as Array<keyof BomItem>);

  const items: BomItem[] = [];
  for (let i = looksLikeHeader ? 1 : 0; i < lines.length; i++) {
    const cells = split(lines[i]);
    const raw: Record<string, unknown> = {};
    columns.forEach((col, idx) => {
      if (col) raw[col] = cells[idx];
    });
    if (!raw.name) {
      errors.push(`第 ${i + 1} 行缺少名称，已跳过`);
      continue;
    }
    items.push(
      withComputedCost({
        name: String(raw.name),
        quantity: Number(raw.quantity) || 0,
        unit: String(raw.unit || ""),
        unitPrice: Number(raw.unitPrice) || 0,
        supplier: raw.supplier ? String(raw.supplier) : undefined,
        spec: raw.spec ? String(raw.spec) : undefined,
      })
    );
  }

  return { items, errors };
}

/** 汇总：原料类成本合计，供成本模块直接取用。 */
export function summarizeBom(items: BomItem[]): { count: number; totalCost: number; warnings: string[] } {
  const totalCost = round2(items.reduce((sum, it) => sum + (Number(it.cost) || 0), 0));
  const warnings = items
    .filter((it) => it.warnings?.length)
    .flatMap((it) => it.warnings!.map((w) => `${it.name}: ${w}`));
  return { count: items.length, totalCost, warnings };
}
