import type { PendingShare } from './types';

/** Bluesky's post length limit, counted in grapheme clusters. */
export const MAX_GRAPHEMES = 300;

const segmenter = new Intl.Segmenter();

/**
 * Count user-perceived characters the way Bluesky does (grapheme clusters),
 * so emoji and combined characters count as 1.
 */
export function graphemeLength(text: string): number {
  if (!text) return 0;
  let count = 0;
  for (const _ of segmenter.segment(text)) count++;
  return count;
}

/** Insert text at a textarea's UTF-16 selection and return its next caret position. */
export function insertAtSelection(
  text: string,
  insertion: string,
  selectionStart: number,
  selectionEnd: number,
): { text: string; caret: number } {
  const start = Math.max(0, Math.min(selectionStart, text.length));
  const end = Math.max(start, Math.min(selectionEnd, text.length));
  return {
    text: `${text.slice(0, start)}${insertion}${text.slice(end)}`,
    caret: start + insertion.length,
  };
}

/** Replace a UTF-16 range within text and return the caret at the insertion's end. */
export function replaceRange(
  text: string,
  start: number,
  end: number,
  insertion: string,
): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  return {
    text: `${text.slice(0, from)}${insertion}${text.slice(to)}`,
    caret: from + insertion.length,
  };
}

/** Trim text to a grapheme budget, appending an ellipsis when truncated. */
export function truncateToGraphemes(text: string, max: number): string {
  if (max <= 0) return '';
  if (graphemeLength(text) <= max) return text;
  let result = '';
  let used = 0;
  for (const segment of segmenter.segment(text)) {
    if (used >= max - 1) break;
    result += segment.segment;
    used++;
  }
  return `${result.trimEnd()}…`;
}

/** Compose initial post text for a context-menu share or cross-post hand-off. */
export function buildShareText(share: PendingShare): string {
  if (share.kind === 'crosspost') return share.text ?? '';
  if (share.kind === 'selection') {
    const url = share.url ?? '';
    // Reserve room for quotes, separators, and the URL inside the 300 limit.
    const reserved = url ? graphemeLength(url) + 4 : 2;
    const quote = truncateToGraphemes((share.text ?? '').trim(), MAX_GRAPHEMES - reserved);
    return url ? `“${quote}”\n\n${url}` : `“${quote}”`;
  }
  return share.url ?? '';
}
