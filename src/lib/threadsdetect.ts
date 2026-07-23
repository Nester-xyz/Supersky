/**
 * Detection of "the user just published a main post on Threads", for the
 * cross-post suggestion. Like the X detector, everything here is defensive:
 * Threads' DOM is unversioned and carries no data-testids, so every guard errs
 * toward staying silent rather than offering at the wrong moment.
 *
 * Anchors confirmed against the live composer:
 *  - the editor is a Lexical box: div[data-lexical-editor="true"][role="textbox"];
 *  - an empty editor reports innerText as "\n", so emptiness is a trimmed check;
 *  - the primary Post button sits immediately before "Post Options" in the
 *    footer (with an exact-text fallback);
 *  - a reply or quote embeds the referenced post, which links to /post/.
 *
 * Main posts only. A capture is skipped when the composer is a thread (more
 * than one editor) or a reply/quote (an embedded post link is present).
 */

import { MAX_IMAGES } from './images';
import type { CapturedPost } from './types';

const EDITOR_SELECTOR = '[data-lexical-editor="true"]';
/** Threads localizes button text; these are the English labels we anchor on. */
const POST_LABEL = 'Post';
const POST_OPTIONS_LABEL = 'Post Options';

/** How long a post gets to visibly succeed before the offer is abandoned. */
const CONFIRM_TIMEOUT_MS = 10_000;
const CONFIRM_POLL_MS = 250;

/**
 * Watch the page for main posts being published (Post button click or
 * Cmd/Ctrl+Enter) and call back once the composer confirms the send by
 * unmounting or clearing. Returns an unsubscribe function.
 */
export function watchForMainThreadsPosts(onPosted: (post: CapturedPost) => void): () => void {
  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLElement>('[role="button"]');
    if (!button) return;
    const root = composerRootFor(button);
    if (root && isPrimaryPostButton(button, root)) void beginCapture(root, onPosted);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
    const active = document.activeElement;
    const editor = active instanceof Element ? active.closest(EDITOR_SELECTOR) : null;
    if (!editor) return;
    const root = composerRootFor(editor);
    if (root) void beginCapture(root, onPosted);
  };

  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
  return () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
  };
}

/**
 * The smallest ancestor holding the whole composer (editor + footer). Walking
 * up from the trigger keeps the scope tight, so guards and media capture never
 * see unrelated page content.
 */
function composerRootFor(trigger: Element): Element | null {
  let node: Element | null = trigger.parentElement;
  while (node && node !== document.body) {
    if (node.querySelector(EDITOR_SELECTOR)) return node;
    node = node.parentElement;
  }
  return null;
}

function editorsIn(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(EDITOR_SELECTOR)];
}

/**
 * Whether `button` is the composer's primary Post button. The reliable anchor
 * is position, it's the button immediately before "Post Options", with an
 * exact-text match as the fallback.
 */
function isPrimaryPostButton(button: Element, root: Element): boolean {
  const buttons = [...root.querySelectorAll<HTMLElement>('[role="button"]')];
  const options = buttons.find((b) => b.textContent?.trim() === POST_OPTIONS_LABEL);
  if (options) {
    const before = buttons[buttons.indexOf(options) - 1];
    if (before) return before === button || before.contains(button);
  }
  return button.textContent?.trim() === POST_LABEL;
}

/** True when this composer is writing a plain, standalone main post. */
function isMainPostComposer(root: Element): boolean {
  // A thread renders more than one editor.
  if (editorsIn(root).length !== 1) return false;
  // Replies and quotes embed the referenced post, which links to its permalink.
  if (root.querySelector('a[href*="/post/"]')) return false;
  return true;
}

/** One confirmation loop at a time; a newer send supersedes the previous. */
let captureToken = 0;

async function beginCapture(root: Element, onPosted: (post: CapturedPost) => void): Promise<void> {
  if (!isMainPostComposer(root)) return;
  const editor = editorsIn(root)[0];
  if (!editor) return;

  const text = normalizeEditorText(editor.innerText);

  // Snapshot attachment previews immediately: Threads revokes the blob URLs
  // once the composer unmounts. Avatars and GIF-picker media are https CDN
  // URLs, so filtering to blob: leaves only user-attached photos.
  const sources = [
    ...new Set(
      [...root.querySelectorAll<HTMLImageElement>('img')]
        .map((img) => img.src)
        .filter((src) => src.startsWith('blob:')),
    ),
  ].slice(0, MAX_IMAGES);
  const imagesPromise = Promise.all(
    sources.map((src) =>
      fetch(src)
        .then((response) => (response.ok ? response.blob() : null))
        .catch(() => null),
    ),
  );

  // A user-attached video previews as <video> behind a blob URL; grab the
  // first. GIF-picker media streams from a CDN and stays unportable.
  const videoElements = [...root.querySelectorAll('video')];
  const videoSource = videoElements
    .map((el) => el.src || el.currentSrc || el.querySelector('source')?.src || '')
    .find((src) => src.startsWith('blob:'));
  let video: Blob | null = null;
  if (videoSource) {
    video = await fetch(videoSource)
      .then((response) => (response.ok ? response.blob() : null))
      .catch(() => null);
    // Object URLs occasionally lose their mime; the bytes are still the file.
    if (video && !video.type) video = new Blob([video], { type: 'video/mp4' });
    if (video && !video.type.startsWith('video/')) video = null;
  }
  const unportableVideo = videoElements.length > 0 && !video;

  const images = (await imagesPromise).filter(
    (blob): blob is Blob => blob !== null && blob.type.startsWith('image/'),
  );

  if (!text && images.length === 0 && !video) return;

  // Confirm the send: the composer dialog unmounts (or the editor clears).
  // Anything else within the window (validation error, cancelled) stays quiet.
  const token = ++captureToken;
  const startedAt = Date.now();
  for (;;) {
    await sleep(CONFIRM_POLL_MS);
    if (token !== captureToken) return;
    const gone = !document.contains(root) || !document.contains(editor);
    const cleared = !gone && normalizeEditorText(editor.innerText) === '';
    if (gone || cleared) break;
    if (Date.now() - startedAt > CONFIRM_TIMEOUT_MS) return;
  }

  onPosted({ text, images, video, unportableVideo });
}

/** Editor text, with placeholder artifacts trimmed but line breaks intact. */
function normalizeEditorText(raw: string): string {
  const text = raw.replace(/\u00A0/g, ' ');
  return text.trim() === '' ? '' : text.replace(/\s+$/, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
