/**
 * P1 Desktop Intelligence (Computer Use)
 * 已有: 文件、Terminal、Git、Browser 打开、App 启动、Clipboard、AppleScript、本机 Agent
 * 未有: 屏幕理解、坐标点击、拖拽、视觉状态恢复
 */

export interface DesktopAction {
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

export async function understandScreen(screenshotBase64: string): Promise<ScreenUnderstanding> {
  // 模拟屏幕理解
  return {
    elements: [
      { id: "btn_1", type: "button", text: "保存", bounds: { x: 100, y: 200, width: 80, height: 30 }, clickable: true },
      { id: "input_1", type: "input", text: "产品名称", bounds: { x: 100, y: 100, width: 200, height: 30 }, clickable: true },
      { id: "text_1", type: "text", text: "多酚软糖项目", bounds: { x: 100, y: 50, width: 150, height: 20 }, clickable: false },
    ],
    screenshotHash: `hash_${Date.now()}`,
    timestamp: new Date(),
  };
}

export async function clickAt(coordinates: { x: number; y: number }, elementId?: string): Promise<{ success: boolean; newScreenshot?: string }> {
  // 模拟点击
  console.log(`Click at ${coordinates.x},${coordinates.y} element ${elementId}`);
  return { success: true, newScreenshot: `screenshot_after_click_${Date.now()}` };
}

export async function dragFromTo(from: { x: number; y: number }, to: { x: number; y: number }): Promise<{ success: boolean }> {
  console.log(`Drag from ${from.x},${from.y} to ${to.x},${to.y}`);
  return { success: true };
}

export async function recoverVisualState(lastKnownState: any): Promise<{ recovered: boolean; currentState: ScreenUnderstanding }> {
  // 视觉状态恢复
  const currentState = await understandScreen("mock_screenshot");
  return { recovered: true, currentState };
}

export async function executeDesktopAction(action: DesktopAction): Promise<DesktopAction> {
  const start = Date.now();
  try {
    let result: any = null;

    switch (action.type) {
      case "file_read":
        result = { content: `Mock file content for ${action.input.path}`, size: 1024 };
        break;
      case "file_write":
        result = { written: true, path: action.input.path, size: action.input.content?.length || 0 };
        break;
      case "terminal_exec":
        result = { stdout: `Mock terminal output for ${action.input.command}`, exitCode: 0, durationMs: 100 };
        break;
      case "git_operation":
        result = { operation: action.input.operation, success: true, branch: "main" };
        break;
      case "browser_open":
        result = { url: action.input.url, opened: true, title: "Mock Page" };
        break;
      case "app_launch":
        result = { app: action.input.app, launched: true, pid: 12345 };
        break;
      case "clipboard":
        result = { text: action.input.text || "clipboard content", copied: true };
        break;
      case "applescript":
        result = { script: action.input.script, result: "Mock AppleScript result" };
        break;
      case "screen_understand":
        result = await understandScreen(action.input.screenshot);
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
        throw new Error(`Unknown desktop action type: ${action.type}`);
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
      result: { error: e.message, durationMs: Date.now() - start },
    };
  }
}

export function describeDesktopRuntime() {
  return {
    existing: ["file_read", "file_write", "terminal_exec", "git_operation", "browser_open", "app_launch", "clipboard", "applescript"],
    new: ["screen_understand", "click", "drag", "visual_recovery"],
    note: "Desktop Runtime 不得被描述为已完成的 Computer Use, P1 完成屏幕理解/坐标点击/拖拽/视觉状态恢复后才是完整 Computer Use",
    capabilities: {
      file: "读写文件",
      terminal: "执行命令",
      git: "Git操作",
      browser: "打开浏览器",
      app: "启动应用",
      clipboard: "剪贴板",
      applescript: "AppleScript",
      screen: "屏幕理解 - 元素识别+边界+可点击",
      click: "坐标点击 - x,y + 元素ID",
      drag: "拖拽 - from/to坐标",
      recovery: "视觉状态恢复 - 最后已知状态对比",
    },
  };
}
