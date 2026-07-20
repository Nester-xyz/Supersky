/**
 * Post interaction settings: who may reply (threadgate) and whether quote
 * posts are allowed (postgate). Kept as a plain serializable shape so it can
 * ride inside publish requests and saved drafts; the atproto record building
 * happens in the background at publish time.
 */

export interface ReplyRules {
  mode: 'everybody' | 'nobody' | 'custom';
  /** The custom combination; ignored unless mode === 'custom'. */
  mention: boolean;
  following: boolean;
  followers: boolean;
  /** AT-URIs of user lists whose members may reply. */
  lists: string[];
}

export interface InteractionSettings {
  quotesEnabled: boolean;
  replies: ReplyRules;
}

export function defaultInteraction(): InteractionSettings {
  return {
    quotesEnabled: true,
    replies: { mode: 'everybody', mention: false, following: false, followers: false, lists: [] },
  };
}

export function isDefaultInteraction(settings: InteractionSettings): boolean {
  return settings.quotesEnabled && settings.replies.mode === 'everybody';
}

/** A custom rule set with nothing selected collapses to "nobody". */
export function hasCustomRules(replies: ReplyRules): boolean {
  return replies.mention || replies.following || replies.followers || replies.lists.length > 0;
}

/**
 * The `allow` value for an `app.bsky.feed.threadgate` record: `undefined`
 * means everybody (no record is written at all), `[]` means nobody, otherwise
 * the list of rule objects.
 */
export function threadgateAllowRules(
  settings: InteractionSettings,
): Array<Record<string, unknown>> | undefined {
  const { replies } = settings;
  if (replies.mode === 'everybody') return undefined;
  if (replies.mode === 'nobody' || !hasCustomRules(replies)) return [];
  const allow: Array<Record<string, unknown>> = [];
  if (replies.mention) allow.push({ $type: 'app.bsky.feed.threadgate#mentionRule' });
  if (replies.following) allow.push({ $type: 'app.bsky.feed.threadgate#followingRule' });
  if (replies.followers) allow.push({ $type: 'app.bsky.feed.threadgate#followerRule' });
  for (const list of replies.lists.slice(0, 5 - allow.length)) {
    allow.push({ $type: 'app.bsky.feed.threadgate#listRule', list });
  }
  return allow;
}

/** Short label for the composer pill. */
export function summarizeInteraction(settings: InteractionSettings): string {
  const repliesOpen = settings.replies.mode === 'everybody';
  if (repliesOpen && settings.quotesEnabled) return 'Anyone can interact';
  if (repliesOpen) return 'Quotes disabled';

  const noReplies =
    settings.replies.mode === 'nobody' ||
    (settings.replies.mode === 'custom' && !hasCustomRules(settings.replies));
  const replyPart = noReplies ? 'Replies disabled' : 'Replies limited';
  return settings.quotesEnabled ? replyPart : `${replyPart} · no quotes`;
}
