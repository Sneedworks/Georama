// Card 1.10 export errors (detail v1, Stage A). Codes are fixed: param, limit, length, deflate.
export type ExportErrorCode = 'param' | 'limit' | 'length' | 'deflate';

export class ExportError extends Error {
  readonly code: ExportErrorCode;

  constructor(code: ExportErrorCode, message: string) {
    super(message);
    this.name = 'ExportError';
    this.code = code;
  }
}
