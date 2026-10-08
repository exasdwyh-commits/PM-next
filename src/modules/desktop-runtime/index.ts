/**
 * Desktop Runtime barrel
 *
 * P1 Desktop Intelligence (Computer Use)
 * 已有: 文件、Terminal、Git、Browser 打开、App 启动、Clipboard、AppleScript、本机 Agent
 * 未有: 屏幕理解、坐标点击、拖拽、视觉状态恢复（见 ./extended-actions）
 */

// 契约与纯函数
export * from "./contracts";
export * from "./confirmation";
export * from "./presence";
export * from "./local-fs";

// 运行时服务（队列 / 审批 / 概览）
export * from "./service";

// P1 扩展动作
export * from "./extended-actions";