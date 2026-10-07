/** 应用版本号：由 next.config.ts 在构建时从 package.json 注入（KX-25 页脚 / 侧栏状态区用）。 */
export const APP_VERSION: string = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
