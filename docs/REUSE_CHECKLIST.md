# 旧版资产复用与迁移检查表 (B01)

日期：2026-09-07  
参考源工程：`hermes-pm-hub-cockpit-truth/`  
原则：旧版是参考与候选资产，不是新版需求标准；择优吸收设计经验，彻底杜绝机械式复制。

---

## 候选资产逐项评估记录

| 候选资产路径 | 旧版逻辑与依赖 | 新版需求与差异 | 决定 | 理由与改造说明 | 验证证据 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `src/lib/access-control.ts` | 基于简单角色字符串比较，部分接口信任前端传来的 userId/role | P0 第 4 节：严格由服务端会话鉴权，项目级别多角色矩阵，防自批，生产环境硬禁 Mock Auth | **彻底重写** | 重构为 `modules/identity/session.ts`，基于数据库 `ProjectMember` 关系实时鉴权，无客户端伪造入口 | A03, A12 全绿 |
| `src/lib/approval/valid-approval.ts` | 审批记录简单跳转，未校验预算范围与证据真实性，缺乏事务保障 | P0 第 6/7 节：研发打样门门禁需校验 DEMO 隔离、市场依据、预算动作授权、并联动生成单项打样任务 | **彻底重写** | 重写为 `modules/decisions/service.ts` 中的 `decideDecisionPacket`，与状态变更、打样任务同事务原子写入 | A05, A06, A11 全绿 |
| `src/lib/version-fingerprint.ts` | 简单指纹机制，针对部分富文本页面取哈希，易因排版/评论变动引起误失效 | P0 第 6 节：使用排序后的规范化结构数据计算，评论与排版不得使批准失效 | **改造吸收** | 重新实现为 `modules/decisions/scope-hash.ts`，精准对排序后版本列表及预算要素取 SHA-256 | A08 全绿 |
| `src/lib/project/project-stage.ts` | 线性阶段跳转，未对新品与固定产品进行模式分流 | P0 第 5/6 节：新品可无产品直接起步，固定产品必须绑定既有已确认不可变版本并直跳准备阶段 | **重写** | 纳入 `modules/projects/service.ts`，阶段推进由明确的业务命令与打样门裁决驱动，无非法越级通道 | A01, A02, A06 全绿 |
| `prisma/schema.prisma` (旧版 3773 行) | 基于 SQLite，混杂大量未裁剪字段、浮点数金额、单字段枚举复合等技术债 | P0 第 2/5 节：独立 PostgreSQL 17，金额定点化（Decimal），UTC 时间，强审计与幂等表 | **独立设计** | 仅提取 15 张核心表，严格落地字段级类型约束与级联关系，彻底去除 SQLite 兼容包袱 | A11 事务验证通过 |
