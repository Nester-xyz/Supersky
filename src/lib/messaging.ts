import { browser } from 'wxt/browser';
import { errorCode, toErrorMessage } from './errors';
import type {
  AccountSnapshot,
  ActorSuggestion,
  AuthState,
  LinkCardData,
  ListSuggestion,
  LoginRequest,
  NotificationPage,
  PendingShare,
  PublishRequest,
  PublishResult,
} from './types';

/**
 * Every request/response pair exchanged between extension pages and the
 * background service worker. Adding a feature = adding an entry here; both
 * sides stay type-checked.
 */
export interface MessageContracts {
  'auth:login': { input: LoginRequest; output: AccountSnapshot };
  'auth:logout': { input: { did?: string }; output: AuthState };
  'auth:switch': { input: { did: string }; output: AuthState };
  'auth:get-state': { input: undefined; output: AuthState };
  'card:fetch': { input: { url: string }; output: LinkCardData | null };
  'post:publish': { input: PublishRequest; output: PublishResult[] };
  'actor:search-typeahead': { input: { query: string; limit?: number }; output: ActorSuggestion[] };
  /**
   * Check the account's daily video quota and mint the service-auth token the
   * popup needs to upload straight to video.bsky.app.
   */
  'video:auth': { input: { did: string }; output: { token: string } };
  /** The active account's curated lists, for threadgate list rules. */
  'lists:get': { input: undefined; output: ListSuggestion[] };
  /** Stash a pending share and open the composer popup (cross-post hand-off). */
  'composer:open': { input: PendingShare; output: null };
  /** Poll now and report the unread count (null when signed out/unknown). */
  'notif:refresh': { input: undefined; output: { count: number | null } };
  /**
   * A grouped page of the active account's notifications for the panel.
   * `filter: 'mentions'` narrows to conversations (replies, mentions, quotes)
   * server-side, matching the official app's All | Mentions split.
   */
  'notif:list': {
    input: { cursor?: string; filter?: 'all' | 'mentions' };
    output: NotificationPage;
  };
  /** Mark everything read (updateSeen), then reconcile the toolbar badge. */
  'notif:seen': { input: undefined; output: { count: number | null } };
  /** Follow an account back from a follow notification. */
  'graph:follow': { input: { did: string }; output: null };
  /** Chrome-level banner permission; 'unknown' where the API is unsupported. */
  'notif:status': { input: undefined; output: { permission: 'granted' | 'denied' | 'unknown' } };
  /** Fire a sample banner so the user can verify OS-level delivery. */
  'notif:test': { input: undefined; output: null };
}

export type MessageType = keyof MessageContracts;

interface Envelope<K extends MessageType = MessageType> {
  __supersky: true;
  type: K;
  payload: MessageContracts[K]['input'];
}

type Response<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

export class MessagingError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'MessagingError';
    this.code = code;
  }
}

/** Send a typed request to the background service worker. */
export async function sendMessage<K extends MessageType>(
  type: K,
  payload: MessageContracts[K]['input'],
): Promise<MessageContracts[K]['output']> {
  const envelope: Envelope<K> = { __supersky: true, type, payload };
  const response = (await browser.runtime.sendMessage(envelope)) as
    | Response<MessageContracts[K]['output']>
    | undefined;
  if (!response) {
    throw new MessagingError('The background service did not respond. Try reopening the popup.');
  }
  if (!response.ok) throw new MessagingError(response.error, response.code);
  return response.data;
}

type Handlers = {
  [K in MessageType]: (
    payload: MessageContracts[K]['input'],
  ) => Promise<MessageContracts[K]['output']>;
};

/** Wire the message router in the background service worker. */
export function registerHandlers(handlers: Handlers): void {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const envelope = message as Partial<Envelope> | undefined;
    if (!envelope || envelope.__supersky !== true || !envelope.type) return;
    const handler = handlers[envelope.type] as
      | ((payload: unknown) => Promise<unknown>)
      | undefined;
    if (!handler) return;

    handler(envelope.payload)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err: unknown) =>
        sendResponse({ ok: false, error: toErrorMessage(err), code: errorCode(err) }),
      );
    // Keep the channel open for the async response above.
    return true;
  });
}

// ---------------------------------------------------------------------------
// One-way events (background -> open extension pages)
// ---------------------------------------------------------------------------

export interface BroadcastEvent {
  __superskyEvent: true;
  kind: 'auth-changed';
  state: AuthState;
}

/** Fire-and-forget notification to any open popup/options page. */
export function broadcastAuthChanged(state: AuthState): void {
  const event: BroadcastEvent = { __superskyEvent: true, kind: 'auth-changed', state };
  // Throws when no page is listening; that is fine.
  void browser.runtime.sendMessage(event).catch(() => undefined);
}

export function onAuthChanged(callback: (state: AuthState) => void): () => void {
  const listener = (message: unknown) => {
    const event = message as Partial<BroadcastEvent> | undefined;
    if (event?.__superskyEvent === true && event.kind === 'auth-changed' && event.state) {
      callback(event.state);
    }
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}
