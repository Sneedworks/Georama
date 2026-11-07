// Card 2.3, detail v2.2 (section 3; D1, D5, D6, D7; A1, A2, A4, A5, A6): the command bus with undo, redo
// and transactions. Core code: no DOM and no Node APIs.
import type { Command, Verdict, VerdictCode } from './command.ts';

interface Step {
  readonly label: string;
  readonly commands: readonly Command[];
  readonly bytes: number;
}

interface OpenTransaction {
  readonly label: string;
  readonly commands: Command[];
}

function ok(): Verdict<void> {
  return { ok: true, value: undefined };
}

function fail(code: VerdictCode): Verdict<void> {
  return { ok: false, code };
}

export class CommandBus {
  /** D1: the byte bound for stored tile data. */
  readonly maxBytes: number;
  private readonly maxSteps: number;
  private readonly past: Step[] = [];
  private readonly future: Step[] = [];
  private pastBytes = 0;
  private open: OpenTransaction | null = null;

  constructor(options: { maxSteps: number; maxBytes: number }) {
    this.maxSteps = options.maxSteps;
    this.maxBytes = options.maxBytes;
  }

  /** Applies a command and records it: as one step, or as part of the open transaction (D5). */
  execute(command: Command): void {
    command.apply();
    if (this.open !== null) {
      this.open.commands.push(command);
      return;
    }
    this.record({ label: command.label, commands: [command], bytes: command.bytes });
  }

  undo(): Verdict<void> {
    if (this.open !== null) return fail('nested');
    const step = this.past.pop();
    if (step === undefined) return fail('empty-history');
    this.pastBytes -= step.bytes;
    for (let i = step.commands.length - 1; i >= 0; i -= 1) {
      step.commands[i].revert();
    }
    this.future.push(step);
    return ok();
  }

  redo(): Verdict<void> {
    if (this.open !== null) return fail('nested');
    const step = this.future.pop();
    if (step === undefined) return fail('empty-history');
    for (const command of step.commands) {
      command.apply();
    }
    this.past.push(step);
    this.pastBytes += step.bytes;
    return ok();
  }

  /** Groups the commands executed inside `fn` into one undo step (D5). */
  transaction(label: string, fn: (bus: CommandBus) => void): Verdict<void> {
    if (this.open !== null) return fail('nested');
    const transaction: OpenTransaction = { label, commands: [] };
    this.open = transaction;
    try {
      fn(this);
    } catch (error) {
      for (let i = transaction.commands.length - 1; i >= 0; i -= 1) {
        transaction.commands[i].revert();
      }
      this.open = null;
      throw error;
    }
    this.open = null;
    if (transaction.commands.length > 0) {
      const bytes = transaction.commands.reduce((sum, command) => sum + command.bytes, 0);
      this.record({ label, commands: transaction.commands, bytes });
    }
    return ok();
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  stats(): { steps: number; bytes: number } {
    return { steps: this.past.length, bytes: this.pastBytes };
  }

  /**
   * D6: a newly recorded command clears redo. D1: the oldest steps are dropped first until both bounds
   * hold; the newly recorded step is never dropped by its own recording.
   */
  private record(step: Step): void {
    this.future.length = 0;
    this.past.push(step);
    this.pastBytes += step.bytes;
    while (this.past.length > 1 && (this.past.length > this.maxSteps || this.pastBytes > this.maxBytes)) {
      const dropped = this.past.shift();
      if (dropped !== undefined) this.pastBytes -= dropped.bytes;
    }
  }
}
