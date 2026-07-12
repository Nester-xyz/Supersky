import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { badgeColor } from '@/lib/accents';
import { searchActorsTypeahead } from '@/lib/atproto/actor';
import { fetchLinkCard } from '@/lib/atproto/linkcard';
import { publishPost } from '@/lib/atproto/post';
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
import type { PendingShare, PublishRequest, PublishResult } from '@/lib/types';

const BADGE_ALARM = 'supersky:badge';

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
    'badge:refresh': async () => {
      await updateBadge();
      return null;
    },
  });

  // A single hook: session.ts computes the fresh snapshot, we fan it out to any
  // open page and reconcile the toolbar badge (which reads the active account).
  setOnAuthChanged((state) => {
    broadcastAuthChanged(state);
    void updateBadge();
  });

  browser.runtime.onInstalled.addListener((details) => {
    void installContextMenus();
    void scheduleBadge();
    // Greet fresh installs with the welcome tab (not on updates/reloads).
    if (details.reason === 'install') void openWelcome();
  });
  browser.runtime.onStartup.addListener(() => {
    void scheduleBadge();
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    void handleMenuClick(info, tab);
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === BADGE_ALARM) void updateBadge();
  });
  watchSettings(() => {
    void scheduleBadge();
  });

  // Also reconcile whenever the worker wakes up.
  void scheduleBadge();
});

// ---------------------------------------------------------------------------
// Publishing — one draft to one or more accounts
// ---------------------------------------------------------------------------

/**
 * Publish a draft as each requested account. Blobs are PDS-specific, so
 * publishPost re-uploads images per account. Fails only if every copy fails;
 * a partial success returns what landed so the composer can report the count.
 */
async function publishToAccounts(request: PublishRequest): Promise<PublishResult[]> {
  const dids = request.dids?.length ? request.dids : null;
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
// Context menus — share the page, a link, or selected text
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
// Toolbar badge — unread notification count
// ---------------------------------------------------------------------------

async function scheduleBadge(): Promise<void> {
  const settings = await loadSettings();
  if (!settings.showBadge) {
    await browser.alarms.clear(BADGE_ALARM);
    await paintBadge(0);
    return;
  }
  const existing = await browser.alarms.get(BADGE_ALARM);
  if (!existing) {
    browser.alarms.create(BADGE_ALARM, { periodInMinutes: 1 });
  }
  await updateBadge();
}

async function updateBadge(): Promise<void> {
  try {
    const settings = await loadSettings();
    if (!settings.showBadge) return paintBadge(0);
    const agent = await getAgent();
    if (!agent) return paintBadge(0);
    const response = await agent.app.bsky.notification.getUnreadCount();
    await paintBadge(response.data.count);
  } catch {
    // Offline or mid-refresh — keep whatever the badge shows now.
  }
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
