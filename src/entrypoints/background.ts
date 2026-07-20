import type { AppBskyNotificationListNotifications, AtpAgent } from '@atproto/api';
import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { badgeColor } from '@/lib/accents';
import { searchActorsTypeahead } from '@/lib/atproto/actor';
import { fetchMyLists } from '@/lib/atproto/graph';
import { fetchLinkCard } from '@/lib/atproto/linkcard';
import { publishPost } from '@/lib/atproto/post';
import { beginVideoUpload } from '@/lib/atproto/video';
import {
  getAgent,
  getAuthState,
  login,
  logout,
  requireAgent,
  requireAgentForDid,
  setOnAuthChanged,
  switchAccount,
} from '@/lib/atproto/session';
import { broadcastAuthChanged, registerHandlers } from '@/lib/messaging';
import { loadSettings, watchSettings } from '@/lib/settings';
import { setPendingShare } from '@/lib/share';
import { postWebUrl } from '@/lib/urls';
import type { PendingShare, PublishRequest, PublishResult } from '@/lib/types';

const BADGE_ALARM = 'supersky:badge';
const LAST_COUNT_KEY = 'supersky:badge-count';
const NOTIFIED_AT_KEY = 'supersky:notified-at';
/** Id for the grouped "N new notifications" toast; individual toasts use their
 * target URL as the id (clicking resolves it without any lookup). */
const SUMMARY_TOAST_ID = 'supersky:new-notifications';
const NOTIFICATIONS_URL = 'https://bsky.app/notifications';
const RETRY_DELAY_MS = 10_000;
/** Chrome's floor since v120; older browsers just clamp up to their minimum. */
const POLL_PERIOD_MINUTES = 0.5;
/** Extra poll halfway through each alarm cycle, for a ~15s effective cadence. */
const MID_POLL_DELAY_MS = 15_000;
/** More fresh events than this per poll collapse into one summary toast. */
const MAX_INDIVIDUAL_TOASTS = 4;

const MENU_IDS = {
  page: 'supersky:share-page',
  link: 'supersky:share-link',
  selection: 'supersky:share-selection',
} as const;

export default defineBackground(() => {
  registerHandlers({
    'auth:login': (request) => login(request),
    'auth:logout': ({ did }) => logout(did),
    'auth:switch': ({ did }) => switchAccount(did),
    'auth:get-state': () => getAuthState(),
    'card:fetch': ({ url }) => fetchLinkCard(url),
    'post:publish': (request) => publishToAccounts(request),
    'actor:search-typeahead': async ({ query, limit }) =>
      searchActorsTypeahead(await requireAgent(), query, limit),
    'video:auth': async ({ did }) => beginVideoUpload(await requireAgentForDid(did)),
    'lists:get': async () => fetchMyLists(await requireAgent()),
    'notif:refresh': async () => ({ count: await refreshNotifications() }),
    'notif:status': async () => ({ permission: await notificationPermission() }),
    'notif:test': () => sendTestToast(),
  });

  // A single hook: session.ts computes the fresh snapshot, we fan it out to any
  // open page and reconcile the toolbar badge (which reads the active account).
  setOnAuthChanged((state) => {
    broadcastAuthChanged(state);
    void refreshNotifications();
  });

  browser.runtime.onInstalled.addListener((details) => {
    void installContextMenus();
    void schedulePolling();
    // Greet fresh installs with the welcome tab (not on updates/reloads).
    if (details.reason === 'install') void openWelcome();
  });
  browser.runtime.onStartup.addListener(() => {
    void schedulePolling();
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    void handleMenuClick(info, tab);
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== BADGE_ALARM) return;
    void refreshNotifications();
    // Halve the effective cadence: one extra poll mid-cycle while the worker
    // is alive; if it has already died by then, the next alarm covers it.
    setTimeout(() => void refreshNotifications(), MID_POLL_DELAY_MS);
  });
  browser.notifications.onClicked.addListener((id) => {
    void browser.notifications.clear(id);
    // Individual toasts carry their destination as their id (Focalize's trick);
    // the grouped toast goes to the inbox.
    const url = id.startsWith('https://') ? id : id === SUMMARY_TOAST_ID ? NOTIFICATIONS_URL : null;
    if (url) void browser.tabs.create({ url });
  });
  watchSettings(() => {
    void schedulePolling();
  });

  // Also reconcile whenever the worker wakes up.
  void schedulePolling();
});

// ---------------------------------------------------------------------------
// Publishing: one draft to one or more accounts
// ---------------------------------------------------------------------------

/**
 * Publish a draft as each requested account. Blobs are PDS-specific, so
 * publishPost re-uploads images per account. Fails only if every copy fails;
 * a partial success returns what landed so the composer can report the count.
 */
async function publishToAccounts(request: PublishRequest): Promise<PublishResult[]> {
  const dids = request.dids?.length ? request.dids : null;
  // Video blobs are minted per-repo by the upload session, so a video post
  // can't fan out; the composer locks the target picker to enforce this too.
  if (request.video && dids && dids.length > 1) {
    throw new Error('Video posts can only go to one account at a time.');
  }
  if (!dids) return [await publishPost(await requireAgent(), request)];

  const results: PublishResult[] = [];
  const errors: string[] = [];
  for (const did of dids) {
    try {
      results.push(await publishPost(await requireAgentForDid(did), request));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Failed to post.');
    }
  }
  if (results.length === 0) {
    throw new Error(errors[0] ?? 'Could not post to any of the selected accounts.');
  }
  return results;
}

// ---------------------------------------------------------------------------
// Context menus: share the page, a link, or selected text
// ---------------------------------------------------------------------------

async function installContextMenus(): Promise<void> {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: MENU_IDS.page,
    title: 'Share page on Bluesky',
    contexts: ['page'],
  });
  browser.contextMenus.create({
    id: MENU_IDS.link,
    title: 'Share link on Bluesky',
    contexts: ['link'],
  });
  browser.contextMenus.create({
    id: MENU_IDS.selection,
    title: 'Share quote on Bluesky',
    contexts: ['selection'],
  });
}

async function handleMenuClick(
  info: Browser.contextMenus.OnClickData,
  tab: Browser.tabs.Tab | undefined,
): Promise<void> {
  let share: PendingShare;
  switch (info.menuItemId) {
    case MENU_IDS.link:
      share = { kind: 'link', url: info.linkUrl };
      break;
    case MENU_IDS.selection:
      share = { kind: 'selection', text: info.selectionText, url: tab?.url, title: tab?.title };
      break;
    case MENU_IDS.page:
      share = { kind: 'page', url: tab?.url ?? info.pageUrl, title: tab?.title };
      break;
    default:
      return;
  }
  await setPendingShare(share);
  await openComposer();
}

async function openWelcome(): Promise<void> {
  try {
    await browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') });
  } catch {
    // Tab creation can lose a startup race; the toolbar popup still works.
  }
}

async function openComposer(): Promise<void> {
  try {
    // Available in Chrome 127+; throws elsewhere or without a user gesture.
    await browser.action.openPopup();
  } catch {
    await browser.windows.create({
      url: browser.runtime.getURL('/popup.html') + '?mode=window',
      type: 'popup',
      width: 424,
      height: 660,
    });
  }
}

// ---------------------------------------------------------------------------
// Notifications: toolbar badge count + desktop banners for new activity
// ---------------------------------------------------------------------------

/** Human phrasing per notification reason; unknown reasons get a fallback. */
const REASON_PHRASES: Record<string, string> = {
  like: 'liked your post',
  repost: 'reposted your post',
  follow: 'followed you',
  mention: 'mentioned you',
  reply: 'replied to your post',
  quote: 'quoted your post',
  'starterpack-joined': 'joined your starter pack',
  'like-via-repost': 'liked your repost',
  'repost-via-repost': 'reposted your repost',
};

// A slow in-flight poll must never paint over a fresher one (alarm ticks, auth
// changes, and popup opens can overlap): each poll takes a ticket, and only
// the holder of the newest ticket may touch the badge, banner, or cache.
let pollTicket = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

async function schedulePolling(): Promise<void> {
  const settings = await loadSettings();
  if (!settings.showBadge && !settings.showBanners) {
    await browser.alarms.clear(BADGE_ALARM);
    await browser.storage.local.remove(LAST_COUNT_KEY);
    await paintBadge(0);
    return;
  }
  if (settings.showBadge) {
    // Repaint the last known count before fetching: after a browser restart
    // the badge is blank, and the first fetch may be slow or offline.
    const stored = await browser.storage.local.get(LAST_COUNT_KEY);
    const cached = stored[LAST_COUNT_KEY];
    if (typeof cached === 'number' && cached > 0) await paintBadge(cached);
  } else {
    await paintBadge(0);
  }
  // Recreate on period change too: the alarm outlives extension updates, so a
  // stale slower cadence would silently stick around forever otherwise.
  const existing = await browser.alarms.get(BADGE_ALARM);
  if (existing?.periodInMinutes !== POLL_PERIOD_MINUTES) {
    browser.alarms.create(BADGE_ALARM, { periodInMinutes: POLL_PERIOD_MINUTES });
  }
  await refreshNotifications();
}

/**
 * Poll the active account's unread count, reconcile the badge, and banner any
 * activity that arrived since the last poll. Returns the fresh count, or null
 * when the features are off, the user is signed out, or the fetch failed.
 */
async function refreshNotifications(options?: { isRetry?: boolean }): Promise<number | null> {
  const ticket = ++pollTicket;
  if (retryTimer !== undefined) {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }
  const settings = await loadSettings();
  if (!settings.showBadge && !settings.showBanners) {
    await paintBadge(0);
    return null;
  }
  try {
    const agent = await getAgent();
    if (!agent) {
      if (ticket === pollTicket) {
        await paintBadge(0);
        await browser.storage.local.remove(LAST_COUNT_KEY);
        await clearToasts();
      }
      return null;
    }
    const response = await agent.app.bsky.notification.getUnreadCount();
    const count = response.data.count;
    if (ticket !== pollTicket) return count;
    if (settings.showBadge) await paintBadge(count);
    await browser.storage.local.set({ [LAST_COUNT_KEY]: count });
    if (settings.showBanners) await announceNew(agent, count);
    return count;
  } catch {
    // Offline or mid-refresh: keep whatever the badge shows now and try once
    // more shortly; the minute alarm is the backstop if the worker dies first.
    if (ticket === pollTicket && !options?.isRetry) {
      retryTimer = setTimeout(() => {
        void refreshNotifications({ isRetry: true });
      }, RETRY_DELAY_MS);
    }
    return null;
  }
}

type NotificationView = AppBskyNotificationListNotifications.Notification;

/** Pop desktop toasts for whatever arrived since the last poll. */
async function announceNew(agent: AtpAgent, count: number): Promise<void> {
  const did = agent.session?.did;
  if (!did) return;
  if (count === 0) {
    // Everything was read elsewhere (bsky.app, phone), so drop stale toasts.
    await clearToasts();
    return;
  }
  const response = await agent.app.bsky.notification.listNotifications({ limit: 25 });
  const items = response.data.notifications;
  const newest = items[0]?.indexedAt;
  if (!newest) return;

  const seenUpTo = (await readWatermarks())[did];
  if (!seenUpTo) {
    // First poll for this account: adopt the current head silently so a fresh
    // install (or re-enabling banners) never replays the existing backlog.
    await writeWatermark(did, newest);
    return;
  }

  const seenTime = Date.parse(seenUpTo);
  const fresh = items.filter((item) => !item.isRead && Date.parse(item.indexedAt) > seenTime);
  const first = fresh[0];
  if (!first) return;
  await writeWatermark(did, newest);

  // A burst collapses into one grouped toast instead of flooding the corner.
  if (fresh.length > MAX_INDIVIDUAL_TOASTS) {
    await browser.notifications.create(SUMMARY_TOAST_ID, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: `${fresh.length} new notifications`,
      message: `${authorName(first)} ${reasonPhrase(first)} and ${fresh.length - 1} more`,
      ...branding(),
    });
    return;
  }
  // Oldest first, so the most recent event ends up on top of the OS stack.
  for (const item of [...fresh].reverse()) {
    await createToast(did, item);
  }
}

function authorName(item: NotificationView): string {
  return item.author.displayName?.trim() || `@${item.author.handle}`;
}

function reasonPhrase(item: NotificationView): string {
  return REASON_PHRASES[item.reason] ?? 'sent you a new notification';
}

/** Where a toast should land: the relevant post, profile, or the inbox. */
function toastUrl(did: string, item: NotificationView): string {
  switch (item.reason) {
    case 'like':
    case 'repost':
      // reasonSubject is the post of yours they interacted with.
      return item.reasonSubject ? postWebUrl(did, item.reasonSubject) : NOTIFICATIONS_URL;
    case 'reply':
    case 'quote':
    case 'mention':
      // Their post is the notification subject itself.
      return postWebUrl(item.author.did, item.uri);
    case 'follow':
      return `https://bsky.app/profile/${item.author.did}`;
    default:
      return NOTIFICATIONS_URL;
  }
}

async function createToast(did: string, item: NotificationView): Promise<void> {
  // Replies, quotes, and mentions carry the author's post text, so surface it.
  const record = item.record as { text?: unknown } | undefined;
  const text = typeof record?.text === 'string' ? record.text : '';
  const avatar = await fetchIconDataUrl(item.author.avatar);
  await browser.notifications.create(toastUrl(did, item), {
    type: 'basic',
    iconUrl: avatar ?? browser.runtime.getURL('/icon/128.png'),
    title: `${authorName(item)} ${reasonPhrase(item)}`,
    message: text.length > 140 ? `${text.slice(0, 139)}…` : text,
    ...branding(),
  });
}

/**
 * Label the toast body as Supersky's, since the OS header only ever credits
 * the browser. Firefox rejects the property, so it's added everywhere else.
 */
function branding(): { contextMessage?: string } {
  return import.meta.env.BROWSER === 'firefox' ? {} : { contextMessage: 'Supersky' };
}

/**
 * Inline a remote avatar as a data: URL, since notification icons can't
 * reference the web directly. Returns null on any failure so callers fall back
 * to the extension icon.
 */
async function fetchIconDataUrl(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

async function clearToasts(): Promise<void> {
  try {
    // getAll only ever returns this extension's notifications.
    const all = await browser.notifications.getAll();
    await Promise.all(Object.keys(all).map((id) => browser.notifications.clear(id)));
  } catch {
    // Nothing shown, or the API is unavailable. Either way we're done.
  }
}

/** Whether Chrome will show our banners at all ('unknown' on Firefox). */
async function notificationPermission(): Promise<'granted' | 'denied' | 'unknown'> {
  try {
    if (typeof browser.notifications.getPermissionLevel !== 'function') return 'unknown';
    const level = await browser.notifications.getPermissionLevel();
    return level === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unknown';
  }
}

/** A sample banner for the settings page, so delivery is verifiable end-to-end. */
async function sendTestToast(): Promise<null> {
  // Unique id so repeat clicks re-alert instead of silently replacing.
  await browser.notifications.create(`supersky:test:${Date.now()}`, {
    type: 'basic',
    iconUrl: browser.runtime.getURL('/icon/128.png'),
    title: 'Supersky banners are working',
    message: 'New likes, replies, mentions, and follows will pop up like this.',
    ...branding(),
  });
  return null;
}

/** Newest notification timestamp already announced, keyed by account DID. */
async function readWatermarks(): Promise<Record<string, string>> {
  const stored = await browser.storage.local.get(NOTIFIED_AT_KEY);
  return (stored[NOTIFIED_AT_KEY] as Record<string, string> | undefined) ?? {};
}

async function writeWatermark(did: string, indexedAt: string): Promise<void> {
  const watermarks = await readWatermarks();
  watermarks[did] = indexedAt;
  await browser.storage.local.set({ [NOTIFIED_AT_KEY]: watermarks });
}

async function paintBadge(count: number): Promise<void> {
  const text = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
  await browser.action.setBadgeText({ text });
  if (count > 0) {
    const { accent } = await loadSettings();
    await browser.action.setBadgeBackgroundColor({ color: badgeColor(accent) });
    try {
      await browser.action.setBadgeTextColor({ color: '#ffffff' });
    } catch {
      // Not supported everywhere; the default is fine.
    }
  }
}
