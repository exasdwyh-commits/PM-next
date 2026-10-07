# KX-32 办公产出：Word / Excel / PPT 导出 + 回读校验

## 做了什么

- 任务工作区「产出」页多了三个按钮：Word / Excel / PPT（原来只有 MD / PDF）。
- 接口：`GET /api/missions/[id]/export?format=docx|xlsx|pptx`，是在原导出路由上加的格式，鉴权沿用原路由（authz 矩阵不变）。
- 内容来源和「导出 MD」完全一样（`loadMissionReport` → `MissionReport`），三种格式口径一致。

## 结构

`src/modules/supervisor/office-export.ts`（只在服务端按需 `import()`，不进客户端包）：

- `markdownBlocks(md)`：纯函数，把产出解析成 heading / bullet / para / table 块；代码块（包括 kern-artifact 机器块）整段跳过。
- DOCX：标题 → 日期与状态 → 演示数据标注 → 已确认约束 → 需要你决定 → 结论 → 每个步骤一节 → 消耗与用到的记忆。表格保留成 Word 表格，字体用 Microsoft YaHei。
- XLSX：「概览」页、「步骤」页，再给每张 Markdown 表格建一页（页名不超过 31 字符且不重复，纯数字单元格写成数字）。首行加粗并冻结。
- PPTX：16:9，一页封面、一页结论、一页「建议与待你决定」（有才出）、每个步骤一页（最多 6 条要点：先取列表项，再取段落首句）。演示数据每页都有角标。

## 回读校验

生成后立即重新解析，不一致就报错，坏文件不会交给用户：

| 格式 | 校验 |
|---|---|
| DOCX | 解压 word/document.xml，段落数 ≥ 3，表格数 ≥ 报告里的 Markdown 表格数 |
| XLSX | 用 exceljs 重新加载，每个工作表的行数与写入时一致 |
| PPTX | 统计 ppt/slides/slideN.xml，页数与计划一致 |

响应头：`X-Kern-SHA256`（文件哈希）、`X-Kern-Check`（URL 编码的校验明细 JSON）。

## 测试

`tests/kern-office-export.test.ts`，OX1–OX5，已加入 `test:regression-units`。

## 踩坑

- 解析表格的行循环曾忘了 `i += 1`，导致死循环并 OOM（测试进程无输出，挂到超时）。已修。
- 在 Windows 上 `outputs/_x.cjs` 里 `require` 这些库会找不到模块，要用 `require.resolve(m, { paths: [process.cwd()] })`。

## 以后

- 上传到网盘或邮件（KX-31 连接器）后，用同一个 SHA-256 回读核对。
- 图表：artifact 里的 chart 暂时只进 XLSX 数据表，还没有生成原生图表。
