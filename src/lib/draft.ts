import { browser } from 'wxt/browser';
import type { AttachedGif } from './gifs';
import type { InteractionSettings } from './interaction';
import type { ComposerImagePayload, ThreadPostPayload } from './types';

/**
 * Two layers of not-losing-your-post:
 *  - the autosave slot: the whole in-progress draft (text, language, images,
 *    GIF, interaction settings), written as you edit and restored silently
 *    when the popup reopens. Popups close on any outside click with no chance
 *    to prompt, so restoring everything is the only reliable safety net;
 *  - saved drafts: explicit snapshots kept on a shelf behind the Drafts
 *    button, like the official app's drafts.
 * Videos are never persisted: their upload session dies with the popup.
 */

const AUTOSAVE_KEY = 'supersky:draft';
/**
 * Images autosave under their own key so the (large) payload is rewritten
 * only when the attachments actually change, not on every keystroke.
 */
const AUTOSAVE_MEDIA_KEY = 'supersky:draft-media';
const DRAFTS_KEY = 'supersky:drafts';

/** Keep the list snappy and the storage footprint sane. */
export const MAX_DRAFTS = 20;

interface AutosaveMeta {
  text: string;
  /** Additional thread posts below the root. */
  extraPosts?: string[];
  lang?: string;
  gif?: AttachedGif | null;
  interaction?: InteractionSettings | null;
  savedAt: number;
}

/** Autosaves older than this are considered stale and dropped. */
const AUTOSAVE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function saveAutosaveMeta(meta: {
  text: string;
  extraPosts: string[];
  lang: string;
  gif: AttachedGif | null;
  interaction: InteractionSettings | null;
}): Promise<void> {
  if (!meta.text.trim() && meta.extraPosts.length === 0 && !meta.gif && !meta.interaction) {
    await browser.storage.local.remove(AUTOSAVE_KEY);
    return;
  }
  const slot: AutosaveMeta = { ...meta, savedAt: Date.now() };
  await browser.storage.local.set({ [AUTOSAVE_KEY]: slot });
}

export async function saveAutosaveImages(images: ComposerImagePayload[]): Promise<void> {
  if (images.length === 0) {
    await browser.storage.local.remove(AUTOSAVE_MEDIA_KEY);
    return;
  }
  await browser.storage.local.set({ [AUTOSAVE_MEDIA_KEY]: images });
}

export interface RestoredAutosave {
  text: string;
  extraPosts: string[];
  /** null when nothing was stored (fall back to the settings default). */
  lang: string | null;
  gif: AttachedGif | null;
  interaction: InteractionSettings | null;
  images: ComposerImagePayload[];
}

export async function loadAutosave(): Promise<RestoredAutosave | null> {
  const stored = await browser.storage.local.get([AUTOSAVE_KEY, AUTOSAVE_MEDIA_KEY]);
  // Pre-multi-media versions stored only { text, savedAt }; the optional
  // fields below absorb that shape unchanged.
  const meta = stored[AUTOSAVE_KEY] as Partial<AutosaveMeta> | undefined;
  const images = (stored[AUTOSAVE_MEDIA_KEY] as ComposerImagePayload[] | undefined) ?? [];
  const extraPosts = Array.isArray(meta?.extraPosts) ? meta.extraPosts : [];
  if (!meta?.text && extraPosts.length === 0 && !meta?.gif && images.length === 0) return null;
  if (meta?.savedAt && Date.now() - meta.savedAt > AUTOSAVE_MAX_AGE_MS) {
    await clearDraft();
    return null;
  }
  return {
    text: meta?.text ?? '',
    extraPosts,
    lang: typeof meta?.lang === 'string' ? meta.lang : null,
    gif: meta?.gif ?? null,
    interaction: meta?.interaction ?? null,
    images,
  };
}

export async function clearDraft(): Promise<void> {
  await browser.storage.local.remove([AUTOSAVE_KEY, AUTOSAVE_MEDIA_KEY]);
}

// ---------------------------------------------------------------------------
// Saved drafts
// ---------------------------------------------------------------------------

export interface SavedDraft {
  id: string;
  text: string;
  /** Additional thread posts below the root (absent on older drafts). */
  extraPosts?: ThreadPostPayload[];
  lang: string;
  savedAt: number;
  images: ComposerImagePayload[];
  gif: AttachedGif | null;
  interaction: InteractionSettings | null;
  /** The draft had a video attached; videos themselves are not persisted. */
  hadVideo: boolean;
}

export async function listSavedDrafts(): Promise<SavedDraft[]> {
  const stored = await browser.storage.local.get(DRAFTS_KEY);
  const drafts = stored[DRAFTS_KEY];
  return Array.isArray(drafts) ? (drafts as SavedDraft[]) : [];
}

/** Prepend a new draft; newest first. Throws when the shelf is full. */
export async function addSavedDraft(
  draft: Omit<SavedDraft, 'id' | 'savedAt'>,
): Promise<SavedDraft> {
  const drafts = await listSavedDrafts();
  if (drafts.length >= MAX_DRAFTS) {
    throw new Error(`You can keep up to ${MAX_DRAFTS} drafts. Delete one to save another.`);
  }
  const record: SavedDraft = { ...draft, id: crypto.randomUUID(), savedAt: Date.now() };
  await browser.storage.local.set({ [DRAFTS_KEY]: [record, ...drafts] });
  return record;
}

export async function deleteSavedDraft(id: string): Promise<SavedDraft[]> {
  const drafts = await listSavedDrafts();
  const next = drafts.filter((draft) => draft.id !== id);
  if (next.length !== drafts.length) {
    await browser.storage.local.set({ [DRAFTS_KEY]: next });
  }
  return next;
}
