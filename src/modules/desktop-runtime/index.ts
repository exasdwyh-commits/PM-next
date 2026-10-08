export * from "./contracts";
export * from "./presence";
export * from "./service";
export * from "./confirmation";

// P1 Desktop Intelligence（屏幕理解/坐标点击/拖拽/视觉恢复）。
// 与上面的服务层分开导出：该文件是能力声明 + 模拟实现，服务层的任务编排不受影响。
// 注意：此模块内的动作类型叫 ComputerUseAction，与 ./contracts 的 DesktopAction（真实协议）
// 刻意不同名——两者语义与结构都不同，同名会造成 barrel 导出冲突。
export * from "./computer-use";
