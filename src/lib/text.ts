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

/** Compose initial post text for a context-menu share. */
export function buildShareText(share: PendingShare): string {
  if (share.kind === 'selection') {
    const url = share.url ?? '';
    // Reserve room for quotes, separators, and the URL inside the 300 limit.
    const reserved = url ? graphemeLength(url) + 4 : 2;
    const quote = truncateToGraphemes((share.text ?? '').trim(), MAX_GRAPHEMES - reserved);
    return url ? `“${quote}”\n\n${url}` : `“${quote}”`;
  }
  return share.url ?? '';
}
