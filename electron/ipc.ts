import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { IPC, type AppInfo } from '../src/shared/ipc.ts';
import { isEditorDocument } from './navigation-guard.ts';

/** Evaluate current authority on every invocation; never trust a resource origin. */
export function isTrustedSender(event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>, expectedWebContents: WebContents | null, editorUrl: string): boolean {
  const frame = event.senderFrame;
  return expectedWebContents !== null && event.sender === expectedWebContents
    && frame !== null && frame !== undefined && frame === expectedWebContents.mainFrame
    && !frame.parent && isEditorDocument(frame.url, editorUrl);
}

export function registerIpc(info: () => AppInfo, expectedWebContents: () => WebContents | null, editorUrl: string): void {
  ipcMain.handle(IPC.getInfo, event => {
    if (!isTrustedSender(event, expectedWebContents(), editorUrl)) throw new Error('untrusted sender');
    return info();
  });
}
