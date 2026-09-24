# PM-next 最终验收基线

日期：2026-09-23  
结论：本机自动化验收 PASS（当前工作区快照）；当前 RC HEAD 的 GitHub CI 证据 PENDING；人工真实业务链验收 PENDING
- 当前 RC 分支提交：`1bea212b2305209be64772c0215c2f68f75aa1b7`
- 最近有完整核心 CI 通过证据的基线：`f05074648d79861f1d57f4218a675ce8bd8b4cae`

## 1. 自动化验收

以下结果记录的是 `f0507464` 在 main 上的 CI，不自动覆盖当前 RC 分支 HEAD：

| 验收面 | 结果 | 核心覆盖 |
| --- | --- | --- |
| Quality CI | PASS | Golden、Potential、Channel Routes、Model Gateway、Model Control、Model Runtime、Harness、Validation Decision、Decision Intelligence、Launch Authorization、typecheck、lint、build |
| Governance CI | PASS | migrate deploy、Governance、Research Snapshot、Formal G2、Formal G3、structured artifacts、gate boundaries |
| Workforce CI | PASS | typecheck、migrate deploy、Workforce Kernel |
| Decision CI | PASS | typecheck、migrate deploy、DecisionRun、System Principal |
| Autopilot CI | PASS | typecheck、migrate deploy、Autopilot |
| Experience CI | PASS | typecheck、migrate deploy、Harness Experience |
| Business Event CI | PASS | typecheck、migrate deploy、Business Event Outbox |
| Golden Organization CI | PASS | AKG / 骆驼奶+AOS / AKK / Channel Route persistence |

## 2. 已验收能力

### A. 产品与证据 — PASS
- Product / ProductVersion
- Evidence / verify status
- REAL / DEMO 边界
- Product Potential / Hard Gate / Validation
- assessment snapshot / evidence fingerprint

### B. 渠道规格路线 — PASS
- 多 ChannelSpecRoute
- 确定性渠道经济性
- revision / supersedes
- confirmed rule lifecycle
- channel-scoped evidence
- persistence regression

### C. 模型控制 — PASS
- ModelProfile / ModelPolicy
- Agent × TaskClass binding
- Provider Runtime
- explicit fallback / fail closed
- ModelRun provenance
- no API key in DB

### D. Workforce — PASS
- Agent / Skill / Squad
- Delegation
- start / finish
- review return
- output summary
- parent action
- activity brief

### E. Decision / Governance — PASS
- Decision Intelligence
- typed rules / Policy Gate
- DecisionRun
- System Principal
- Governance convergence

### F. G1 / G2 / G3 — PASS
- G1 已有正式研发/打样门
- G2 正式生产投入门
- G3 正式上市授权门
- Owner 不可自批
- 决策范围冻结
- 关键输入漂移后旧审批失效
- G2 APPROVED 与真实开工分离
- PRODUCTION_RECORD 与交付确认分离
- G3 强制校验生产依据

### G. 自治与经验 — PASS
- Autopilot durable wakeup
- lease / cooldown
- Business Event Outbox
- automation causality
- child result return
- Evaluation Harness
- Experience persistence
- Golden Organization multi-case

## 3. 本地仍需完成

CI 无法替代：

1. 真实本地 PostgreSQL migrate deploy；
2. 干净 npm ci / build / start；
3. 浏览器人工走通关键路径；
4. 真实 provider / endpoint / key 的受控模型调用；
5. Model Control Runtime missing / fallback 实际显示；
6. 真实产品 Channel Route；
7. G2 真实生产成果录入与 Gate 解释；
8. G1/G2/G3 权限、失效和执行边界人工检查；
9. Workforce / Autopilot UI 回执；
10. 桌面和平板视觉检查。

## 4. 缺陷等级

### P0
必须修：
- 无法安装 / build / start
- migrate deploy 失败
- 数据破坏 / 越权 / 跨组织泄漏
- Governance 或 G1/G2/G3 可绕过
- 同基线核心 CI 失败

### P1
收尾修：
- 核心业务链不可完成
- 关键页面/API 500
- provider routing 错误
- Channel Route / G2 / Workforce / Autopilot 关键交互错误
- Gate 原因无法理解

### P2
进入下一版本：
- 非阻断视觉问题
- 高级动效
- 手机端专项适配
- 更完整 P2 运营细节
- 新模型 / 新 Agent / 新数据源

## 5. 当前接受边界

- 真实商业 provider secret 不在 CI，因此必须本地验证；
- 手机专项适配不是 blocker；
- M4/M5/Jev/P3 属于下一版本；
- F20-F32 中 Formal G2 核心已经完成，但完整供应商协同、质检、渠道锁单和结项运营仍可作为下一版本扩展。

## 6. 最终判定

满足以下即可把当前版本标记完成：

- 8 条核心 CI 绿色；
- 本地 typecheck / lint / build 绿色；
- migrate deploy 绿色；
- 核心浏览器链路通过；
- G1/G2/G3 人工验证通过；
- 无 P0；
- P1 修复或明确接受。

历史自动化基线已经 PASS。2026-09-23 本机复验结果见 §7。当前 RC HEAD 的 GitHub CI 证据与人工真实业务链验收仍待完成，不应将本版本标记为最终完成。

## 7. 2026-09-23 本机复验

验证对象：`HEAD 1bea212b2305209be64772c0215c2f68f75aa1b7` 加当前未提交的 `src/app/products/[id]/launch-tab.tsx` 旧授权撤销入口修复。以下结果证明的是该工作区快照，不是 GitHub Actions 对该提交的结果。

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| 本机 8-workflow 对照矩阵 | PASS | `scripts/local-ci-matrix.sh` 全部步骤通过，含 Prisma generate / migrate deploy、typecheck、lint、production build 与核心回归 |
| 权限矩阵 | PASS | `test:authz`，62 条路由 / 82 个方法，747 项断言 |
| 产品中心 / 科学证据 | PASS | 分别 51/51、30/30 |
| 模型端到端 | PASS | mock Provider 37/37，覆盖成功、超时、500 回退和 token 留痕 |
| HTTP / HTTP 错误 | PASS | 分别 52/52、34/34 |
| Playwright UI | PASS | 基础 UI 13/13；交互反馈 73/73。交互反馈曾因上市页缺失旧授权撤销入口失败，补上仅适用于 LEGACY_APPROVAL 的入口后通过 |
| 数据库迁移 | PASS | 本地 dev/test 库各 24 个迁移，状态均为 up to date；测试脚本的 migrate deploy 通过，无需补迁移 |
| 真实 Provider | PASS（最小 smoke） | `agnes-2.5-flash` 单次最小请求成功，返回期望标记及 token 用量；未发送业务资料，未写入业务记录或 ModelRun |

### 仍待验收

- GitHub Actions 对当前 RC 精确提交的完整矩阵；
- 通过应用的 Model Gateway policy 路由并检查持久化 ModelRun provenance（上述最小 smoke 直接验证了 Provider runtime）；
- 人工走通真实产品的 G1 → G2 → 生产开工 → 交付 → G3 流程；
- 桌面和平板关键页面人工检查。
