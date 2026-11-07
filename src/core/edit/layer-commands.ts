// Card 2.4, detail v2 (section 3): builds a Command from closures; the layer stack holds no other logic here.
// Core code: no DOM and no Node APIs.
import type { Command } from './command.ts';

export function layerCommand(label: string, apply: () => void, revert: () => void, bytes: number): Command {
  return { label, bytes, apply, revert };
}
