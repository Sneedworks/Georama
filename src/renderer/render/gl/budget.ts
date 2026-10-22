import { GlError } from './errors.ts';

export const DEFAULT_GPU_BUDGET_BYTES: number = 3 * 1024 ** 3;

export class GlBudget {
  readonly limitBytes: number;
  private used: number;

  constructor(limitBytes?: number) {
    const limit = limitBytes ?? DEFAULT_GPU_BUDGET_BYTES;
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit <= 0) {
      throw new GlError('LIMIT', `GlBudget: invalid limit ${String(limit)}`);
    }
    this.limitBytes = limit;
    this.used = 0;
  }

  get usedBytes(): number {
    return this.used;
  }

  reserve(bytes: number, label: string): void {
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) {
      throw new GlError('LIMIT', `GlBudget: invalid reservation ${String(bytes)} for ${String(label)}`);
    }
    if (typeof label !== 'string') {
      throw new GlError('LIMIT', 'GlBudget: reservation label must be a string');
    }
    if (this.used + bytes > this.limitBytes) {
      throw new GlError(
        'LIMIT',
        `GlBudget: cannot reserve ${bytes} bytes for ${label} (used ${this.used} of ${this.limitBytes})`,
      );
    }
    this.used += bytes;
  }

  release(bytes: number): void {
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) {
      throw new GlError('LIMIT', `GlBudget: invalid release ${String(bytes)}`);
    }
    if (bytes > this.used) {
      throw new GlError('LIMIT', `GlBudget: cannot release ${bytes} bytes (only ${this.used} used)`);
    }
    this.used -= bytes;
  }
}
