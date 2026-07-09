/** Characters that commonly trail a pasted URL but are not part of it. */
const TRAILING_PUNCTUATION = /[.,;:!?'"‘’“”]+$/;

/**
 * Find the first http(s) URL in free text, trimming trailing punctuation and
 * unbalanced closing parens (e.g. from "(see https://example.com/a).").
 */
export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>()[\]{}"']+(?:\([^\s<>()]*\)[^\s<>()[\]{}"']*)*/i);
  if (!match) return null;
  let url = match[0].replace(TRAILING_PUNCTUATION, '');
  while (url.endsWith(')') && countChar(url, '(') < countChar(url, ')')) {
    url = url.slice(0, -1).replace(TRAILING_PUNCTUATION, '');
  }
  return url || null;
}

function countChar(value: string, char: string): number {
  let count = 0;
  for (const c of value) if (c === char) count++;
  return count;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Canonical bsky.app link for a post record URI (at://did/collection/rkey). */
export function postWebUrl(actor: string, atUri: string): string {
  const rkey = atUri.split('/').pop() ?? '';
  return `https://bsky.app/profile/${actor}/post/${rkey}`;
}
