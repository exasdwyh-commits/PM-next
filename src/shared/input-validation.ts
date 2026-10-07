import { UnprocessableEntityError } from "./errors";

export function assertObjectInput(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new UnprocessableEntityError("请求内容必须是对象");
  }
}

export function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new UnprocessableEntityError(`${field} 必填，且必须为非空文本`, {
      [field]: ["必填，且必须为非空文本"],
    });
  }
  return value.trim();
}

export function assertOptionalText(value: unknown, field: string) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new UnprocessableEntityError(`${field} 必须为文本`, { [field]: ["必须为文本"] });
  }
}

export function assertOptionalBoolean(value: unknown, field: string) {
  if (value !== undefined && typeof value !== "boolean") {
    throw new UnprocessableEntityError(`${field} 必须为布尔值`, { [field]: ["必须为布尔值"] });
  }
}

export function assertOptionalNonnegativeNumber(value: unknown, field: string) {
  if (value !== undefined && value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
    throw new UnprocessableEntityError(`${field} 必须为非负有限数值`, { [field]: ["必须为非负有限数值"] });
  }
}
