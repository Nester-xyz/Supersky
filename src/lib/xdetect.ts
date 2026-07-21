/**
 * Detection of "the user just published a main post on X", for the cross-post
 * suggestion. Everything here is defensive: X's DOM is unversioned, so every
 * guard errs toward staying silent rather than offering at the wrong moment.
 *
 * Main posts only. A capture is skipped when the composer is:
 *  - a reply or quote (the composer container renders the referenced tweet);
 *  - the inline reply box on a tweet's own page;
 *  - a thread (more than one text editor);
 *  - a community post.
 */

/** A snapshot of the just-published post, taken at the moment of sending. */
export interface CapturedTweet {
  text: string;
  /** Image attachments, fetched from the composer's blob previews. */
  images: Blob[];
  /**
   * The first user-attached video, when its bytes were recoverable from the
   * composer's blob preview (X GIF-picker media streams from a CDN instead
   * and can't be captured).
   */
  video: Blob | null;
  /** A video/GIF attachment existed whose bytes could not be carried over. */
  unportableVideo: boolean;
}

const EDITOR_SELECTOR = '[data-testid^="tweetTextarea_"]';
const BUTTON_SELECTOR = '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]';
/** Exact editor ids: `tweetTextarea_0`, `_1`, ... (excludes `_0_label` etc). */
const EDITOR_ID_RE = /^tweetTextarea_\d+$/;

/** How long a post gets to visibly succeed before the offer is abandoned. */
const CONFIRM_TIMEOUT_MS = 10_000;
const CONFIRM_POLL_MS = 250;

/**
 * Watch the page for main posts being published (button click or
 * Cmd/Ctrl+Enter) and call back once the composer confirms the send by
 * clearing or unmounting. Returns an unsubscribe function.
 */
export function watchForMainTweets(onPosted: (tweet: CapturedTweet) => void): () => void {
  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest(BUTTON_SELECTOR);
    if (!button) return;
    const root = composerRootFor(button);
    if (root) void beginCapture(root, onPosted);
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
 * The smallest ancestor holding the whole composer (editor + toolbar). Walking
 * up from the trigger keeps the scope tight, so guards never see unrelated
 * page content.
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
  return [...root.querySelectorAll<HTMLElement>(EDITOR_SELECTOR)].filter((el) =>
    EDITOR_ID_RE.test(el.getAttribute('data-testid') ?? ''),
  );
}

/** True when this composer is writing a plain, standalone main post. */
function isMainPostComposer(root: Element): boolean {
  // Threads: more than one editor.
  if (editorsIn(root).length !== 1) return false;
  // Replies and quotes render the referenced tweet inside the composer
  // container (above for replies, embedded for quotes). Locale-independent.
  if (root.querySelector('article, [data-testid="tweet"]')) return false;
  // The inline box on a tweet's own page is the reply box.
  const path = location.pathname;
  if (/\/status\/\d+/.test(path) && root.querySelector('[data-testid="tweetButtonInline"]')) {
    return false;
  }
  // Community composers post into a community, not the public timeline.
  if (path.startsWith('/i/communities') || /\/communities\//.test(path)) return false;
  return true;
}

/** One confirmation loop at a time; a newer send supersedes the previous. */
let captureToken = 0;

async function beginCapture(
  root: Element,
  onPosted: (tweet: CapturedTweet) => void,
): Promise<void> {
  if (!isMainPostComposer(root)) return;
  const editor = editorsIn(root)[0];
  if (!editor) return;

  const text = normalizeEditorText(editor.innerText);

  // Snapshot attachment previews immediately: X revokes the blob URLs once
  // the composer unmounts.
  const attachments = root.querySelector('[data-testid="attachments"]');
  const sources = attachments
    ? [
        ...new Set(
          [...attachments.querySelectorAll<HTMLImageElement>('img')]
            .map((img) => img.src)
            .filter((src) => src.startsWith('blob:')),
        ),
      ].slice(0, 4)
    : [];
  const imagesPromise = Promise.all(
    sources.map((src) =>
      fetch(src)
        .then((response) => (response.ok ? response.blob() : null))
        .catch(() => null),
    ),
  );

  // Videos preview as <video> with the picked file behind a blob URL; grab the
  // first one. GIF-picker media streams from a CDN and stays unportable.
  const videoElements = attachments ? [...attachments.querySelectorAll('video')] : [];
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

  // Confirm the send: the composer either unmounts (modal) or clears (inline).
  // Anything else within the window (validation error, cancelled) means stay
  // quiet.
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
