export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly fieldErrors?: Record<string, string[]>;

  constructor(message: string, code: string, statusCode: number = 400, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.fieldErrors = fieldErrors;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized") {
    super(message, "UNAUTHORIZED", 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "Forbidden") {
    super(message, "FORBIDDEN", 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Resource not found") {
    super(message, "NOT_FOUND", 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = "Conflict or revision mismatch") {
    super(message, "CONFLICT", 409);
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message: string = "Business rule violated", fieldErrors?: Record<string, string[]>) {
    super(message, "UNPROCESSABLE_ENTITY", 422, fieldErrors);
  }
}

/**
 * 415：请求体形态/编码不被该端点接受（例如向 multipart 上传端点发 JSON）。
 *
 * 存在的理由（D-008）：这类错误此前是 `req.formData()` 抛出的原生 TypeError，
 * 冒到统一错误处理就变成 500 —— 那是「服务端崩了」，而事实是「调用方发错了」。
 */
export class UnsupportedMediaTypeError extends AppError {
  constructor(message: string = "Unsupported media type") {
    super(message, "UNSUPPORTED_MEDIA_TYPE", 415);
  }
}

/**
 * 失败原因是否适合直接展示给用户。
 *
 * 技术异常（Prisma / 网关 / fetch）的原文是英文堆栈，直出正文既读不懂也会泄漏
 * 内部实现；业务异常携带的是中文提示，应当照常透出。诊断原文一律留在结构化字段
 * （`ToolCall.errorReason` / `AgentRun.errorReason`）里供排查，不因此丢失。
 *
 * 返回 `null` 表示「不适合展示」，调用方应改用自己那句可读说明。
 *
 * ⚠️ 判据是「含任意汉字即透出」，因此英文堆栈里若嵌了中文（用户输入、产品名），
 * 整段仍会外泄。同步路径与后台路径都走这一个函数，改动请一并考虑两处。
 */
export function userFacingFailureReason(reason: string): string | null {
  return /[\u4e00-\u9fff]/.test(reason) ? reason : null;
}
