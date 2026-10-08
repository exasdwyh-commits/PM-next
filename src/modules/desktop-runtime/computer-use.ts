import { AppError } from "@/shared/errors";

/**
 * P1 Desktop Intelligence (Computer Use)
 * 已有: 文件、Terminal、Git、Browser 打开、App 启动、Clipboard、AppleScript、本机 Agent
 * 未有: 屏幕理解、坐标点击、拖拽、视觉状态恢复
 */

export interface ComputerUseAction {
  id: string;
  type: "file_read" | "file_write" | "terminal_exec" | "git_operation" | "browser_open" | "app_launch" | "clipboard" | "applescript" | "screen_understand" | "click" | "drag" | "visual_recovery";
  input: any;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  result?: any;
  screenshot?: string;
  coordinates?: { x: number; y: number };
}

export interface ScreenUnderstanding {
  elements: { id: string; type: string; text: string; bounds: { x: number; y: number; width: number; height: number }; clickable: boolean }[];
  screenshotHash: string;
  timestamp: Date;
}

function unavailable(): never {
  throw new AppError("该桌面操作接口尚未接入真实执行器，请使用现有桌面任务流程。", "COMPUTER_USE_UNAVAILABLE", 503);
}

export async function understandScreen(_screenshotBase64: string): Promise<ScreenUnderstanding> { return unavailable(); }
export async function clickAt(_coordinates: { x: number; y: number }, _elementId?: string): Promise<{ success: boolean; newScreenshot?: string }> { return unavailable(); }
export async function dragFromTo(_from: { x: number; y: number }, _to: { x: number; y: number }): Promise<{ success: boolean }> { return unavailable(); }
export async function recoverVisualState(_lastKnownState: unknown): Promise<{ recovered: boolean; currentState: ScreenUnderstanding }> { return unavailable(); }
export async function executeComputerUseAction(_action: ComputerUseAction): Promise<ComputerUseAction> { return unavailable(); }

export function describeDesktopRuntime() {
  return { available: false, mode: "unavailable", existing: [], new: [], capabilities: {}, note: "本接口未连接真实执行器；请使用现有桌面任务流程。" };
}
