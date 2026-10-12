/**
 * Compliance Checklist —— 租户 pack 驱动。
 *
 * 清单数据在 `packs/<id>/domain/compliance.json`（品类 → 合规项）；
 * `src/` 不含任何品类清单或行业条目（见 tests/tenant-neutral-guard.test.ts）。
 * 换租户 = 换 pack，本文件一行不改。
 */
import { tenantCompliance, defaultCategoryKey } from "@/modules/tenant";

export interface ComplianceItem {
  id: string;
  label: string;
  description: string;
  required: boolean;
  category: string;
  estimatedCost?: number; // 预估费用
  estimatedDays?: number; // 预估天数
  status?: "pending" | "done" | "na";
  evidenceRef?: string;
}

/**
 * 当前 pack 的全部合规清单（品类键 → 条目）。
 * 模块求值时读取一次 —— pack 是静态配置，键集在进程内不变。
 */
export const COMPLIANCE_CHECKLISTS: Record<string, ComplianceItem[]> = tenantCompliance().checklists;

export function getComplianceChecklist(category: string): ComplianceItem[] {
  return (
    COMPLIANCE_CHECKLISTS[category] ??
    COMPLIANCE_CHECKLISTS[defaultCategoryKey()] ??
    Object.values(COMPLIANCE_CHECKLISTS)[0] ??
    []
  );
}

export function calculateComplianceCost(category: string): { totalCost: number; totalDays: number; requiredCount: number; optionalCount: number } {
  const checklist = getComplianceChecklist(category);
  let totalCost = 0;
  let totalDays = 0;
  let requiredCount = 0;
  let optionalCount = 0;

  for (const item of checklist) {
    if (item.required) {
      requiredCount++;
      totalCost += item.estimatedCost || 0;
      totalDays = Math.max(totalDays, item.estimatedDays || 0); // 并行，取最大
    } else {
      optionalCount++;
    }
  }

  return { totalCost, totalDays, requiredCount, optionalCount };
}

export function getComplianceForRole(category: string, role: "leadership" | "product" | "sales" | "operator"): ComplianceItem[] {
  const all = getComplianceChecklist(category);
  if (role === "leadership") {
    // 领导只看必需项
    return all.filter(item => item.required).slice(0, 3);
  }
  if (role === "sales") {
    // 销售只看标签和宣称
    return all.filter(item => item.category === "标签" || item.label.includes("宣称") || item.label.includes("标签"));
  }
  // 产品看全部
  return all;
}
