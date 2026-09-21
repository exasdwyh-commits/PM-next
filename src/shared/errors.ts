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
