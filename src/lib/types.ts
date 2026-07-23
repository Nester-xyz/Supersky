import type { AttachedGif } from './gifs';
import type { InteractionSettings } from './interaction';

/** A lightweight snapshot of the signed-in account, safe to cache and render. */
export interface AccountSnapshot {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  /** PDS base URL this account is signed in against, e.g. https://bsky.social */
  service: string;
}

export type AuthState =
  | { status: 'signed-out' }
  | {
      status: 'signed-in';
      /** The account new posts are attributed to by default. */
      account: AccountSnapshot;
      /** Every account with a stored session, including the active one. */
      accounts: AccountSnapshot[];
    };

/** How many accounts can be signed in at once (the first plus two more). */
export const MAX_ACCOUNTS = 3;

/** A person surfaced by @-mention typeahead in the composer. */
export interface ActorSuggestion {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

export interface LoginRequest {
  identifier: string;
  password: string;
  /** Email 2FA code, required when the PDS responds with AuthFactorTokenRequired. */
  authFactorToken?: string;
  service: string;
}

export interface LinkCardData {
  url: string;
  title: string;
  description: string;
  imageUrl?: string;
}

/** An image prepared by the composer, serialized for messaging to the background. */
export interface ComposerImagePayload {
  base64: string;
  mime: string;
  alt: string;
  width: number;
  height: number;
}

/**
 * A processed video ready to embed: the blob JSON returned by the video
 * service's completed job, plus presentation metadata gathered in the popup.
 */
export interface ComposerVideoPayload {
  /** JSON blob ref from app.bsky.video.getJobStatus (opaque to the popup). */
  blob: unknown;
  alt: string;
  width: number;
  height: number;
  /** DID whose upload session produced the blob; the post must be by it. */
  did: string;
}

/** How many posts one thread may carry (root included). */
export const MAX_THREAD_POSTS = 12;

/** One follow-up post in a thread: its text plus its own images. */
export interface ThreadPostPayload {
  text: string;
  images: ComposerImagePayload[];
}

export interface PublishRequest {
  text: string;
  /**
   * Additional thread posts, published beneath the root in one atomic
   * commit. Each may carry its own images; GIFs, video, and link cards stay
   * on the root.
   */
  extraPosts?: ThreadPostPayload[];
  /** AT-URI of the post being replied to; the whole chain nests under it. */
  replyTo?: string | null;
  langs?: string[];
  images: ComposerImagePayload[];
  video?: ComposerVideoPayload | null;
  /** Which post in the thread carries the video (0 = root, the default). */
  videoPostIndex?: number;
  gif?: AttachedGif | null;
  card: LinkCardData | null;
  interaction?: InteractionSettings | null;
  /**
   * Accounts (by DID) to publish this draft as. Omitted or empty means the
   * active account only; more than one fans the same draft out to each.
   */
  dids?: string[];
}

/** A user list surfaced in the interaction-settings sheet. */
export interface ListSuggestion {
  uri: string;
  name: string;
  avatar?: string;
}

export interface PublishResult {
  uri: string;
  cid: string;
  /** Canonical bsky.app URL of the new post. */
  webUrl: string;
  /** Handle of the account this copy was posted as. */
  handle: string;
}

/** One person behind a notification row (grouped rows carry a few). */
export interface NotificationAuthor {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

/**
 * One row in the popup's notifications panel. Likes, reposts, and follows of
 * the same subject are grouped into a single row ("Riya and 3 others…").
 */
export interface NotificationItem {
  /** AT-URI of the newest event in the group; stable enough for React keys. */
  id: string;
  reason: string;
  /** Authors shown on the row (newest first); the rest are counted. */
  authors: NotificationAuthor[];
  othersCount: number;
  /** True only when every event in the group has been seen. */
  isRead: boolean;
  /** indexedAt of the newest event in the group. */
  indexedAt: string;
  /** Their words: the reply/quote/mention post text. */
  text?: string;
  /** Your words: the post of yours they liked/reposted/replied to. */
  subjectText?: string;
  /** bsky.app deep link the row opens. */
  url: string;
  /** reply/quote/mention rows: everything the composer's reply mode needs. */
  replyTo?: {
    uri: string;
    handle: string;
    displayName?: string;
    avatar?: string;
    text: string;
  };
  /** follow rows: whether the active account already follows them back. */
  followedByViewer?: boolean;
}

/** A page of grouped notifications plus the unread count at fetch time. */
export interface NotificationPage {
  items: NotificationItem[];
  cursor?: string;
  unread: number;
}

/**
 * Payload stashed by the background when the user shares via context menu,
 * hands a just-published X post off to the full composer, or replies to a
 * notification banner.
 */
export interface PendingShare {
  kind: 'page' | 'link' | 'selection' | 'crosspost' | 'reply';
  url?: string;
  title?: string;
  text?: string;
  /** crosspost only: images already compressed to Bluesky's limits. */
  images?: ComposerImagePayload[];
  /** crosspost only: follow-up thread posts, each with its own images. */
  extraPosts?: ThreadPostPayload[];
  /**
   * crosspost only: storage.local key holding the handed-off video bytes
   * (base64), which the composer reconstructs, then clears.
   */
  videoKey?: string;
  /** reply only: the post being replied to, rendered above the reply box. */
  replyTo?: string;
  replyToHandle?: string;
  replyToDisplayName?: string;
  replyToAvatar?: string;
  replyToText?: string;
}
