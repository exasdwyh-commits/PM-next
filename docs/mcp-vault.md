# KX-30 凭证保管层

## 为什么

Kern 要替用户接真实系统（KX-31 / KX-33），就一定要拿到 token / API key。之前没有任何安全存放的地方：
要么写进聊天（进入模型上下文和消息记录），要么写进环境变量（只能是单一的系统级凭证）。

## 规则

| 规则 | 实现 |
|---|---|
| 不经过聊天 | 只能在顶栏「凭证」表单里录入（`POST /api/vault`），值输入框是 password 类型 |
| 永不回显 | 没有任何接口返回明文或密文；列表只给 header 名 + 值的末 4 位（值少于 12 字符时连末 4 位也不给） |
| 加密存储 | AES-256-GCM，每条随机 IV；AAD = `userId|target|id`，把密文挪到别的用户 / 目标 / 行都解不开 |
| 一个目标多个 header | 一条凭证最多 8 个 header（如 `Authorization` + `X-Org-Id`）；同一目标可以存多条 |
| 一次性 / 有效期 | `oneTime` 用条件更新 `usedAt IS NULL` 保证并发下只能用一次；`ttlSeconds` 为 1 分钟到 90 天 |
| 目标限定 | 目标是域名（`api.x.com`、`*.x.com`，通配符不含裸域）或 `connector:<id>`；跨目标使用返回 null 并写 `credential.deny` |
| 审计 | `credential.create / use / deny / revoke` 写进 AuditEvent，记录用途、主机、任务 id、header 名，**不记录值** |
| 撤销 | 立即生效并清空密文（不可恢复） |

与受保护动作的关系：`CREDENTIAL_USE_OR_DISCLOSURE` 包括使用和披露两部分。
- 披露：在产品层面不存在（没有导出接口）。
- 使用：用户为某个目标录入凭证，就等于授权 Kern 在这个目标上使用它。跨目标一律拒绝。
- 连接器上的写操作仍然要经过 ToolBroker 和 gate（KX-31）。

## 代码

- `src/modules/vault/crypto.ts`：纯函数，包括加解密、密钥加载、目标 / header 校验、状态、目标匹配、`redactSecrets`。
- `src/modules/vault/index.ts`：服务，包括 `listCredentials`、`createCredential`、`revokeCredential`、`injectCredential`。
- `injectCredential(owner, { host, purpose, credentialId?, missionTaskId? })` → `{ headers, secrets } | null`。
  调用方（工具 / 连接器）**必须**用 `redactSecrets(output, secrets)` 处理回显，再把结果交给模型或写进日志。
- 接口：`GET/POST /api/vault`、`DELETE /api/vault/{id}`，只作用于用户自己的数据，他人一律 404。
- UI：`VaultSheet`（`src/app/muse/components/sheets.tsx`），入口是顶栏「凭证」。
- 数据库：`KernCredential` 表，迁移 `20260928120000_add_kern_credential`（纯新增，不影响已有数据）。

## 密钥

- `KERN_VAULT_KEY`：32 字节，写成 64 位 hex 或 base64。**生产环境缺失时接口返回 503 VAULT_NOT_CONFIGURED**（失败即关闭）。
- 开发 / 测试环境缺失时使用固定派生的开发密钥（版本 0），列表里会标「开发密钥」。这种凭证不能迁移到生产环境。
- 轮换：递增 `KERN_VAULT_KEY_VERSION`，旧版本加密的凭证会解密失败，需要重新录入。当前不做多密钥并存，等有需要再加。
- 本机 `.env` 已生成一把随机密钥（`.env` 不进 git）；`.env.example` 里有说明。
- 注意：`test:authz` 用 `next start`（生产模式），所以本机必须配置这个密钥。

## 测试

- `tests/kern-vault.test.ts`（VT1–VT6，已加入 `test:regression-units`）：加解密与 AAD、密钥配置、校验、状态、目标匹配、不回显。
- `tests/regression-kern-vault.ts`（`npm run test:kern-vault`，连测试库）：列表与 DB 都不含明文、目标匹配、跨目标拒绝、一次性凭证并发只成功一次、过期、撤销、审计齐全且不含值。
- 权限矩阵：+2 路由 / +3 方法，基线 79 / 108，957 项断言全部通过。

## 踩坑

- 服务函数原来叫 `useCredential`，被 eslint 的 react-hooks 规则当成 Hook。已改名为 `injectCredential`。
- 权限矩阵禁止 `req.json().catch(() => ({}))`，要用 `readJsonObjectBody`。
- Windows 上 `prisma generate` 报 EPERM：query engine 的 DLL 被正在运行的 dev server 占用。类型已经生成，引擎版本没变，可以忽略；重启 dev server 后再 generate 一次即可。
