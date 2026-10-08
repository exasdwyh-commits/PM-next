/**
 * P1 Desktop Intelligence (Computer Use) 扩展动作
 *
 * 说明：这里是 P1 新增能力的执行端骨架（屏幕理解 / 坐标点击 / 拖拽 / 视觉状态恢复）。
 * 真正的 DesktopAction 契约在 ./contracts，这里只负责 P1 扩展动作的接口与状态。
 * 注意：不得把本文件描述为已完成的 Computer Use，P1 接入真实屏幕采集后才算完整。
 */

import type { DesktopAction } from "./contracts";

/** P1 扩展动作（不与 contracts.DesktopAction 的工具型联合类型混用） */
export type ExtendedDesktopActionType =
  | "screen_understand"
  | "click"
  | "drag"
  | "visual_recovery";

export interface ExtendedDesktopAction {
  id: string;
  type: ExtendedDesktopActionType;
  input: Record<string, any>;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  result?: any;
  screenshot?: string;
  coordinates?: { x: number; y: number };
}

export interface ScreenUnderstanding {
  elements: {
    id: string;
    type: string;
    text: string;
    bounds: { x: number; y: number; width: number; height: number };
    clickable: boolean;
  }[];
  screenshotHash: string;
  timestamp: Date;
}

export async function understandScreen(
  screenshotBase64: string,
): Promise<ScreenUnderstanding> {
  return {
    elements: [
      { id: "btn_1", type: "button", text: "保存", bounds: { x: 100, y: 200, width: 80, height: 30 }, clickable: true },
      { id: "input_1", type: "input", text: "产品名称", bounds: { x: 100, y: 100, width: 200, height: 30 }, clickable: true },
      { id: "text_1", type: "text", text: "多酚软糖项目", bounds: { x: 100, y: 50, width: 150, height: 20 }, clickable: false },
    ],
    screenshotHash: `hash_${screenshotBase64.length}_${Date.now()}`,
    timestamp: new Date(),
  };
}

export async function clickAt(
  coordinates: { x: number; y: number },
  elementId?: string,
): Promise<{ success: boolean; newScreenshot?: string }> {
  return {
    success: true,
    newScreenshot: `screenshot_after_click_${elementId ?? "unknown"}_${Date.now()}`,
  };
}

export async function dragFromTo(
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<{ success: boolean }> {
  return { success: true };
}

export async function recoverVisualState(
  lastKnownState: any,
): Promise<{ recovered: boolean; currentState: ScreenUnderstanding }> {
  const currentState = await understandScreen("mock_screenshot");
  return { recovered: true, currentState };
}

export async function executeDesktopAction(
  action: ExtendedDesktopAction,
): Promise<ExtendedDesktopAction> {
  const start = Date.now();
  try {
    let result: any = null;

    switch (action.type) {
      case "screen_understand":
        result = await understandScreen(String(action.input.screenshot ?? ""));
        break;
      case "click":
        result = await clickAt(action.input.coordinates, action.input.elementId);
        break;
      case "drag":
        result = await dragFromTo(action.input.from, action.input.to);
        break;
      case "visual_recovery":
        result = await recoverVisualState(action.input.lastKnownState);
        break;
      default:
        throw new Error(`Unknown extended desktop action type: ${(action as ExtendedDesktopAction).type}`);
    }

    return {
      ...action,
      status: "SUCCEEDED",
      result: { ...result, durationMs: Date.now() - start },
    };
  } catch (e: any) {
    return {
      ...action,
      status: "FAILED",
      result: { error: e?.message ?? String(e), durationMs: Date.now() - start },
    };
  }
}

export function describeDesktopRuntime() {
  return {
    existing: [
      "fs.list",
      "fs.read_text",
      "fs.write_text",
      "fs.mkdir",
      "fs.move",
      "shell.run",
      "git.status",
      "git.diff",
      "browser.open",
      "app.open",
      "clipboard.read",
      "clipboard.write",
      "notification.send",
      "mac.applescript",
      "agent.delegate",
    ],
    new: ["screen_understand", "click", "drag", "visual_recovery"],
    note: "Desktop Runtime 不得被描述为已完成的 Computer Use，P1 完成屏幕理解/坐标点击/拖拽/视觉状态恢复后才是完整 Computer Use",
    capabilities: {
      fs: "读写文件",
      shell: "执行命令",
      git: "Git 操作",
      browser: "打开浏览器",
      app: "启动应用",
      clipboard: "剪贴板",
      applescript: "AppleScript",
      screen: "屏幕理解 - 元素识别+边界+可点击",
      click: "坐标点击 - x,y + 元素ID",
      drag: "拖拽 - from/to 坐标",
      recovery: "视觉状态恢复 - 最后已知状态对比",
    },
  };
}

/** 供路由做入参类型守卫用，避免 any 泄漏 */
export function isExtendedDesktopAction(value: unknown): value is ExtendedDesktopAction {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.type === "string" &&
    ["screen_understand", "click", "drag", "visual_recovery"].includes(v.type)
  );
}

export type { DesktopAction };