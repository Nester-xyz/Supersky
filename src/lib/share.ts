import { browser } from 'wxt/browser';
import type { PendingShare } from './types';

const KEY = 'supersky:pending-share';

/**
 * Pending shares live in storage.session: survives service-worker restarts,
 * readable by the popup, gone when the browser closes.
 */
export async function setPendingShare(share: PendingShare): Promise<void> {
  await browser.storage.session.set({ [KEY]: share });
}

/** Read and clear the pending share (each share is consumed once). */
export async function takePendingShare(): Promise<PendingShare | null> {
  const stored = await browser.storage.session.get(KEY);
  const share = (stored[KEY] as PendingShare | undefined) ?? null;
  if (share) await browser.storage.session.remove(KEY);
  return share;
}
