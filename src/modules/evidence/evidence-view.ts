/**
 * Evidence 对外字段白名单（Phase 3A · B6）
 *
 * `fileKey` 是服务端存储键（`.uploads/` 下的物理文件名），属于实现细节：
 * 附件下载走 `GET /api/attachments/<evidenceId>`，客户端不需要也不应知道它。
 * `verifiedByUserId` 同为内部关联 id，UI 一律不展示。
 *
 * 用显式 select 白名单，而不是「查出后 delete」——新字段默认不会自动外发。
 */
export const EVIDENCE_PUBLIC_SELECT = {
  id: true,
  projectId: true,
  contentOrUri: true,
  source: true,
  author: true,
  obtainedAt: true,
  infoDate: true,
  hash: true,
  nature: true,
  verifyStatus: true,
  verifiedAt: true,
  fileSize: true,
  mimeType: true,
  originalFilename: true,
  productRef: true,
  channel: true,
  validationSampleSize: true,
  validationTimeRange: true,
  validationLimitations: true,
  validationStatus: true,
  createdAt: true,
} as const;
