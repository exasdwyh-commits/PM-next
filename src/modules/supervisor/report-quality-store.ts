/**
 * 质量状态落点（L2 视角的再导出）
 * ======================================
 * 实现已下沉到 `@/shared/report-quality-store`：写入方在 L2 supervisor（report-delivery 等），
 * 读取方在 L3 product-rnd（report-view 读报告页/接口的质量状态）。
 * 若实现留在本模块，product-rnd 读质量就会构成「L3 领域 → L2 Kern 核心」的跨层
 * 向上依赖，被架构守卫 AL2 拦下。它是纯序列化逻辑、不依赖任何模块，故下沉。
 *
 * 本文件只做再导出，让 supervisor 内部既有 import 路径继续可用，
 * 不制造第二条真相来源。
 */

export {
  REPORT_QUALITY_SCHEMA_VERSION,
  REPORT_QUALITY_KEY,
  attachQuality,
  readQuality,
} from "@/shared/report-quality-store";
export type { StoredReportQuality, ArchivableReportQuality } from "@/shared/report-quality-store";
