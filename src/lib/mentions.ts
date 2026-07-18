/**
 * The partial @mention being typed immediately before the caret, if any.
 * `start` is the index of the "@" so the composer can replace "@par" with the
 * chosen handle. Facets are still resolved at publish time; this only drives
 * the typeahead menu.
 */
export interface MentionQuery {
  /** Text after the "@" up to the caret (may be empty right after typing "@"). */
  query: string;
  /** UTF-16 index of the "@" character. */
  start: number;
}

// Handles are made of letters, digits, dots, and hyphens. The "@" must open a
// token, at the start of the text or after whitespace, so emails like
// "me@host" never trigger the menu.
const MENTION_BEFORE_CARET = /(?:^|\s)@([a-zA-Z0-9.-]*)$/;

/** Longest a handle can get; stop offering suggestions past it. */
const MAX_QUERY_LENGTH = 40;

export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  const clamped = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, clamped);
  const match = MENTION_BEFORE_CARET.exec(before);
  if (!match) return null;
  const query = match[1] ?? '';
  if (query.length > MAX_QUERY_LENGTH) return null;
  // A trailing dot means the user is still typing the domain; keep the menu open
  // but treat it as an incomplete query so we don't search on a dangling dot.
  return { query, start: clamped - query.length - 1 };
}
