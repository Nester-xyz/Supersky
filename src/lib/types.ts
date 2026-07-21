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
  /**
   * Whether the account's email is confirmed. Bluesky requires this to upload
   * videos, so the composer hides the video affordance when it's explicitly
   * false. Undefined means not yet known (treated as allowed).
   */
  emailConfirmed?: boolean;
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

export interface PublishRequest {
  text: string;
  langs?: string[];
  images: ComposerImagePayload[];
  video?: ComposerVideoPayload | null;
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

/**
 * Payload stashed by the background when the user shares via context menu, or
 * hands a just-published X post off to the full composer.
 */
export interface PendingShare {
  kind: 'page' | 'link' | 'selection' | 'crosspost';
  url?: string;
  title?: string;
  text?: string;
  /** crosspost only: images already compressed to Bluesky's limits. */
  images?: ComposerImagePayload[];
}
