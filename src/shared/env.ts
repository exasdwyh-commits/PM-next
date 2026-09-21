import fs from "fs";
import path from "path";

/**
 * 最小 .env 载入（B01-02）：进程级环境变量优先，仅补齐缺失项。
 * 连接串只出现在环境配置里，代码与 package scripts 中不再出现任何口令。
 */
export function loadEnvFiles() {
  for (const fileName of [".env", ".env.local", ".env.test"]) {
    try {
      const file = path.join(process.cwd(), fileName);
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, "utf8");
      for (const rawLine of content.split("\n")) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#") || !line.includes("=")) continue;
        const idx = line.indexOf("=");
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
      }
    } catch {
      // 读取失败不影响上层：环境变量仍可来自真实运行环境
    }
  }
}
