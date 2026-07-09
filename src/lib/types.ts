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
  | { status: 'signed-in'; account: AccountSnapshot };

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

export interface PublishRequest {
  text: string;
  langs?: string[];
  images: ComposerImagePayload[];
  card: LinkCardData | null;
}

export interface PublishResult {
  uri: string;
  cid: string;
  /** Canonical bsky.app URL of the new post. */
  webUrl: string;
}

/** Payload stashed by the background when the user shares via context menu. */
export interface PendingShare {
  kind: 'page' | 'link' | 'selection';
  url?: string;
  title?: string;
  text?: string;
}
