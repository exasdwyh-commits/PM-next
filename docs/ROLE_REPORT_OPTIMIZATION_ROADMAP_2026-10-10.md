# 角色报告优化 · 总路线与交接协议（2026-10-10）

> **接手必读（任何 agent / 新会话的第一份文件）**
> 本文档是「角色报告+深度报告」优化线的唯一事实源：已做什么、雷在哪、
> 下一刀切哪、怎么验收。GitHub 状态（PR/Checks）优先于本文档；
> 每次合并后必须回来更新「§2 状态快照」。

---

## 0. 系统一句话定位

PM-next：Kern 主 Agent 驱动的产品研发操作系统。核心哲学——**宁可 UNKNOWN，绝不编造**：
任何视图/报告缺数据时渲染缺口块（写明「缺什么/如何补齐」），禁止整段消失，更禁止写死数字。

## 1. 批次执行协议（铁律，已联合拍板）

1. **串行**：A→E 一批一口，**该批 CI 全绿**才可进入下一批。
2. **PR 规范**：正文走仓内模板（版本/用途/改动/验证/边界/关联）；验证明细与 CI run 链接**放评论**不放正文；合并用 squash，删分支。
3. **诚实口径**：改动里不得引入任何写死数字/掺杂演示值；known mines 见 §4，拆一个少一个。
4. **测试纪律**：不新增 workflow 文件；新契约测试挂进既有 npm 链（先例：`test:product-rnd-fusion`）。
5. **契约纪律**：envelope/报告契约只做**可选字段纯增量**；渲染层永远 fail-closed（畸形输入→UNKNOWN，不抛错不猜测）。
6. **基线校验**：推送之前必须确认本地基==main raw（防并行开发漂移；并行线分支名含 astra 等）。

## 2. 状态快照（2026-10-10 收工态）

| 批次 | PR | 状态 | 备注 |
|---|---|---|---|
| A · 三视图 V3 + 拆销售硬编码 | #58 | ✅ main@4c0e854 | KPI字号/三态徽章/风险截断修复 |
| B · 操盘手角色（四角色闭环） | #59 | ✅ main@7a8b7e6 | 一轮 CI 四红后修复：4 处穷举角色消费点（教训见 §6） |
| 拆雷 · role-aware-report 销售假数据 | #60 | ✅ main@c1ac8960 | 批次A同类雷清零 |
| C · 深度报告先三块（规格/BOM/验证） | **#61** | 🟡 **待合并（CI 13/13 绿，证据评论已挂）** | 甲方案 typed 通道已打通 |
| C+ · 拆 playbook 大雷 | — | ⏳ 在册，拍板开工 | 见 §4 雷① |
| D · 知识库静态注入 | — | ⬜ 未开工 | 4 模块结构化+引用标注+回填通道 |
| E · 收敛固化 | — | ⬜ 未开工 | V1/V2下线、demo收敛、golden全覆盖 |

**下一动作（接手者照做）**：合并 #61（squash，沿用前两批提交题格式）→ 确认 main push CI 绿 → 开 `fix/defuse-playbook-fake-data` 拆雷（§4 雷①已给触点）。

## 3. 路线图（批次 C 之后的功能优化框架，总架构视角）

### P0 · 数据供给侧（最高优先：解锁全部价值）
诚实架构已是长板，但 specialist 目前是守法罢工——**缺真实输入**。不补供给，规划好的视图只是很诚实地空着。

- **P0-1 真实报价/资料入库通道**：OEM 报价单/检测报告/供应商资料上传 → 结构化落库带来源锚点（supplier/规格/MOQ/报价日期）→ 供 formulation_agent / cost_bom_agent 消费 → `result.deep.spec / result.deep.bom` 浮现 → 深度报告 ①② 两 块自动点亮。
  - 验收信号：报告 ① 规格行带 evidenceRef；② BOM 行带 sourceRef（①② 今日仍 UNKNOWN 是设计行为，非缺陷）。
  - 触点：`src/modules/product-rnd/executor-strategies.ts`（两个 stub）、orchestrator `pickTaskDeep` 通道已就绪、`tests/executive-report-deep-contract.test.ts` 加正向用例。
- **P0-2 补证据工作台**：报告 UNKNOWN → 一键转待补任务 → 批量传证 → 来源可信分级（官方>一级>二手）→ 核验状态驱动 ⑧ 验证排期块。

### P1 · 知识飞轮（批次 D 的放大版）
- 知识库 4 模块（合规红线/品类框架/渠道准入/操盘SOP）结构化入锅随仓走先行；
- **回填通道**：真实 OEM 报价区间/检测周期/试销转化率事后回填，让系统越用越懂这家公司（不止懂教科书）；
- kern 合成「产品定位/合规边界/营销策略」时引用条目并标注来源。

### P2 · 角色闭合（四角色数据兑现）
- 操盘手：work item / agent task 的真实 createdAt/finishedAt → phase window 投影（甘特真数据）；
- 决策台账：decisionsRequired → 拍板记录 + 结果回溯 → 喂 operator.criteria 复盘判据。

### P½ · 架构卫生（随批顺手做）
1. **三份角色引擎合并单一 shared 源**：`src/components/kern-role-intelligence.ts`(client)、`src/modules/assistant-runtime/role-intelligence.ts`(server，无英文正则/PAGE_ROLE_MAP，既有差异)、`role-preference.ts` 正则列表——批次 B 的 CI 四红就是漂移实证。
2. 批次 E 既定：V1(`executive-report.tsx`)/V2(`executive-report-v2.tsx`) 下线；demo-report 收敛一版。

### ⚠️ 明确不做
- 数据供给解决前**不加第五个角色/更多视图**（空屏乘法）；
- playbook 假数据路径**只拆不糊**。

## 4. 在册雷清单（known mines，编号即顺序）

| # | 雷 | 位置 | 处置批次 | 状态 |
|---|---|---|---|---|
| ① | `formula_design/cost_optimization/gtm_strategy/product_blueprint` 等节点整片硬编码假数据（10.2元/8.0/7.8/82%/市场200亿…），经生产 API 可达 | `src/modules/product-rnd/playbook.ts`（入口 `src/app/api/playbook/new-product/route.ts`） | **批次 C+（下一批）** | ⏳ 触摸点已侦察，直接开拆 |
| ② | demo 页 mock 假数字 | `src/app/demo-report/page.tsx` | 批次 E（已加「数字为示意」横幅护栏，PR #61） | 🟡 护栏已挂 |
| ③ | sales keyPoints 硬编码 | `src/modules/supervisor/role-aware-report.ts` | — | ✅ #60 已拆 |

雷①拆法建议：保留 `research_market/qa_verification` 两个走真实 research-integration 的节点；其余节点改为 honestBlocked（沿用 executor-strategies 的诚实缺省样式），或与 orchestrator 线合并下线，**删除整条假数据节点优先于加判断**。

## 5. 关键文件速查（接手定位用）

| 文件 | 作用 |
|---|---|
| `src/shared/executive-report-types.ts` | 报告契约（结论/三态/UNKNOWN/operator 投影/deepReport 九块，全部可选增量） |
| `src/modules/product-rnd/orchestrator.ts` | 生产侧核心：specialist 编排、`synthesizeProductRndExecutiveReport`、`buildExecutiveReportPreview` 裁剪 |
| `src/modules/product-rnd/deep-report.ts` | 深度报告聚合+fail-closed 校验单点（纯函数，九节骨架事实源） |
| `src/components/executive-report-role-based.tsx` | 四角色视图（领导/产品/销售/操盘手）+ DeepReportSections 九块 |
| `src/components/executive-report-role.css` | V3 皮肤令牌（--er-*）、op-*/deep-* 追加样式 |
| `src/components/role-context.tsx` + `kern-role-intelligence.ts` | 客户端角色系统（联合类型/LABEL/记忆意图/校验白名单） |
| `src/modules/assistant-runtime/role-intelligence.ts` | 服务端角色引擎（expertsForRole/协作模式；无英文正则，既有差异） |
| `src/modules/memory/role-preference.ts` + `src/app/api/memory/role/route.ts` | 角色偏好记忆与 API 白名单 |
| `tests/executive-report-deep-contract.test.ts` | 深度报告契约测试（fail-closed/骨架/防编造钳制） |
| `product-rnd-panel.tsx` | 报告消费入口（GET /api/projects/[id]/product-rnd 状态→preview） |

## 6. CI / 工具链已知坑（血的教训）

1. **穷举角色消费点**：给 UserRole 联合加成员时，typecheck 会在消费侧炸（Record<UserRole,…>、三角色字面量签名）——先 `grep -rn '"leadership" | "product"'` 全仓再动手（批次 B 四红的根因）。
2. Workflow 文件修改需 token 具 Workflows 权限；本线约定**不改 workflow 文件**。
3. GitHub code search 索引滞后不可靠；定位/比对用 tarball 全量镜像 + grep（`GET /repos/{r}/tarball/{ref}`）。
4. Contents API 推送是先 GET sha 再 PUT；git refs 偶发 422 重试即可；PR 创建 `"head":"<branch>"`、`"base":"main"`。
5. 测试模板：纯函数判据用 `node --import tsx --test`（CI Node 22）；需 DB 的走 `tsx scripts/run-test.ts`（TEST_DATABASE_URL，CI 有 postgres 服务，本地无库勿全链跑）。
6. heredoc 内模板字符串反引号会被 shell 吃——脚本写文件用 write_file，别用 heredoc 内嵌反引号。

## 7. 停更声明规则

本文档随仓走。接手者合并任一 PR 后：更新 §2 快照（PR 状态/main sha/日期），新发现的雷登记 §4，路线调整写 §3 并在 PR 正文「关联」一节引用本文档。
