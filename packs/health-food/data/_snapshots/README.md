# _snapshots · 抓取产物目录（默认位置）

本目录由 `scripts/health-pack/regwatch.mjs` 写入，**动态产物一律不入库**（见同目录 `.gitignore`），
目的是让"跑监控"不会污染工作树——这是实测过的设计缺陷修复：早先 `latest.json` / `changes.md`
被跟踪，导致每次抓取都产生 3 项脏改动。

## 产物

| 文件 | 说明 | 是否入库 |
|---|---|---|
| `<source>/<日期>.html` | 当日页面原件，用于人工核对 L1 原文 | ❌ |
| `<source>/latest.json` | 最近一次抓取记录（httpCode / bytes / sha256 / title / attempts） | ❌ |
| `changes.md` | 变更报告（追加式）：哪天抓了哪些源、有无变更、失败原因 | ❌ |
| `changes-<时间戳>.json` | 有变更时的结构化变更记录 | ❌ |

## 要留档怎么办

- **正式留档**：把某次快照的关键结论人工登记进 `data/regulatory_rules.json`（那才是入库的"事实"），
  并在 `evidenceUrl` 指向官方原文；
- **换位置**：`node scripts/health-pack/regwatch.mjs --state-dir <dir>` 可把产物写到仓库外；
- **定时任务**：`--tolerant` 让网络抖动不报警（仍记入 changes.md），CI 里则不要加该参数。

