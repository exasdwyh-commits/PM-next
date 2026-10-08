# Kern 对话 UX 与 Advanced 视觉交接（2026-10-09）

## 已完成的交互修复

- 低频工具收进“更多”，功能入口保留，Escape 和面板关闭后焦点返回。
- 输入区按实际高度为会话留白，长草稿不遮住末条回复；草稿刷新恢复。
- 初次读取任务失败显示原因和重新读取，重试只读取状态。
- 流程图与步骤列表共享真实节点和依赖；手机默认列表，保持图形入口。
- 详情管理键盘焦点，跨视图切换后关闭可回到相同节点。
- 输入区留白只作用会话主轴，过程面板步骤卡保持自身留白。

## 用户纠正的视觉方向

用户指出此前 UI 更改没有展示其已有美化。核对 Downloads/Kern优化版/PM-next 后确认：advanced demo 及视觉资源没有挂载正式 /muse，前一轮主要接入交互和工作摘要。

用户明确选择 demo-beautified-advanced。现已开始范围限定的 advanced 视觉层：mesh、玻璃面、Bento 工作概览、真实事项环形/条形图、数字入场、主题偏好。此为可继续工作的基础接入，尚未完成原型与正式页面逐屏视觉验收；不得描述为整个美化已完成。

用户随后指定由 Claude 继续美化。任务书在 docs/CLAUDE_KERN_UI_TASKS.md；原型核心资源逐字节保存在 docs/design-reference/advanced-demo/，不用依赖本地 Downloads 路径。

## 验证边界

针对性单测 59/59；交互生产浏览器套件已通过。覆盖真实任务暂停/API200/数据库/刷新、长草稿、焦点、故障恢复无新增任务、手机和减少动效。任务初始状态来自隔离库的明确 demo 夹具，不代表实际模型或 Worker 运行能力。

视觉初版上传前增加正式 /muse 挂载、真实计数图表、深色偏好刷新恢复、窄屏检查。最终运行结果见本轮验收记录；这些行为检查不代表与 advanced 原型的视觉匹配已经验收。

本地截图和日志在 outputs/kern-conversation-ux-20261009/ 与 outputs/kern-advanced-visual-20261009/（不入 Git）；生产验收命令：

```sh
node scripts/run-sh.js scripts/acc-server.sh --port 3236 3237 tests/ui-kern-conversation-ux.ts
```
