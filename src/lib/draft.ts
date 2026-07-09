import { browser } from 'wxt/browser';

const KEY = 'supersky:draft';

export interface Draft {
  text: string;
  savedAt: number;
}

/** Drafts older than this are considered stale and dropped. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function saveDraft(text: string): Promise<void> {
  if (!text.trim()) {
    await clearDraft();
    return;
  }
  const draft: Draft = { text, savedAt: Date.now() };
  await browser.storage.local.set({ [KEY]: draft });
}

export async function loadDraft(): Promise<string | null> {
  const stored = await browser.storage.local.get(KEY);
  const draft = stored[KEY] as Draft | undefined;
  if (!draft?.text) return null;
  if (Date.now() - draft.savedAt > MAX_AGE_MS) {
    await clearDraft();
    return null;
  }
  return draft.text;
}

export async function clearDraft(): Promise<void> {
  await browser.storage.local.remove(KEY);
}
