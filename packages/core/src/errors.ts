/** AgentPack 统一错误：code 用于 GUI/CLI 映射为中文提示与退出码 */
export type ErrorCode =
  | 'PASSWORD_WEAK'
  | 'PASSWORD_WRONG'
  | 'PACK_CORRUPT'
  | 'PACK_FORMAT_UNSUPPORTED'
  | 'REGISTRY_INVALID'
  | 'ITEM_NOT_FOUND'
  | 'IO_ERROR'
  | 'CANCELLED';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly detail?: string;

  constructor(code: ErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
