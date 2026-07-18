import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { browser } from 'wxt/browser';
import { LoginView } from '@/components/auth/LoginView';
import {
  AlertCircleIcon,
  BellIcon,
  CheckIcon,
  ExternalLinkIcon,
  GlobeIcon,
  InfoIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SparkleIcon,
  SunIcon,
  UserIcon,
  UserRoundPlusIcon,
} from '@/components/icons';
import { LogoMark } from '@/components/Logo';
import { Select } from '@/components/Select';
import { Avatar, Button, IconButton, Switch, cx } from '@/components/ui';
import { ACCENTS } from '@/lib/accents';
import { writeAuthCache } from '@/lib/auth-cache';
import { onAuthChanged, sendMessage } from '@/lib/messaging';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  watchSettings,
  type Settings,
  type ThemePref,
} from '@/lib/settings';
import { LANGUAGES } from '@/lib/languages';
import { MAX_ACCOUNTS, type AuthState } from '@/lib/types';

type TabId = 'account' | 'appearance' | 'notifications' | 'posting' | 'about';

const TABS: Array<{ id: TabId; label: string; icon: ReactNode }> = [
  { id: 'account', label: 'Account', icon: <UserIcon size={16} /> },
  { id: 'appearance', label: 'Appearance', icon: <SunIcon size={16} /> },
  { id: 'notifications', label: 'Notifications', icon: <BellIcon size={16} /> },
  { id: 'posting', label: 'Posting', icon: <GlobeIcon size={16} /> },
  { id: 'about', label: 'About', icon: <InfoIcon size={16} /> },
];

export default function App() {
  const [tab, setTab] = useState<TabId>('account');
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    sendMessage('auth:get-state', undefined)
      .then(setAuth)
      .catch(() => setAuth({ status: 'signed-out' }));
    void loadSettings().then(setSettings);
    const offAuth = onAuthChanged(setAuth);
    const offSettings = watchSettings(setSettings);
    return () => {
      offAuth();
      offSettings();
    };
  }, []);

  // Keep the popup's synchronous auth hint in sync from here too, so signing in
  // on this page lets the next popup open straight into the composer.
  useEffect(() => {
    if (auth) writeAuthCache(auth);
  }, [auth]);

  function update(patch: Partial<Settings>) {
    setSettings((prev) => ({ ...prev, ...patch }));
    void saveSettings(patch);
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-3xl px-4 pt-8 pb-28 sm:px-6 sm:pt-10 sm:pb-16">
        <header className="mb-6 flex items-center gap-3.5 sm:mb-8">
          <LogoMark size={44} />
          <h1 className="flex items-end gap-1.5 text-xl font-semibold leading-none tracking-tight text-ink">
            <span>
              Super
              <span className="text-gradient">Sky</span>
            </span>
            <span className="mb-0.5 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-ink-muted">
              v{browser.runtime.getManifest().version}
            </span>
          </h1>
        </header>

        <div className="sm:flex sm:gap-8">
          <nav className="hidden shrink-0 sm:flex sm:w-44 sm:flex-col sm:gap-1">
            {TABS.map(({ id, label, icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cx(
                  'flex cursor-pointer items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm whitespace-nowrap transition-colors',
                  tab === id
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
                )}
              >
                {icon}
                {label}
              </button>
            ))}
          </nav>

          <main className="min-w-0 flex-1">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              {tab === 'account' && <AccountPanel auth={auth} />}
              {tab === 'appearance' && <AppearancePanel settings={settings} update={update} />}
              {tab === 'notifications' && (
                <NotificationsPanel settings={settings} update={update} />
              )}
              {tab === 'posting' && <PostingPanel settings={settings} update={update} />}
              {tab === 'about' && <AboutPanel />}
            </motion.div>
          </main>
        </div>
      </div>

      <MobileTabBar tab={tab} onChange={setTab} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile: a fixed bottom tab bar with a motion pill that slides to the active
// tab. Hidden at sm+, where the vertical sidebar takes over.
// ---------------------------------------------------------------------------

const DOCK_SPRING = { type: 'spring', stiffness: 420, damping: 34 } as const;

function MobileTabBar({ tab, onChange }: { tab: TabId; onChange: (id: TabId) => void }) {
  return (
    // Click-through strip; only the dock itself is interactive. The dock is a
    // compact pill: inactive tabs are icons, the active one expands to show its
    // label on a solid accent pill that slides between tabs.
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 sm:hidden">
      <motion.nav
        layout
        transition={DOCK_SPRING}
        aria-label="Settings sections"
        className="pointer-events-auto flex items-center gap-1 rounded-full border border-line bg-surface/90 p-1.5 shadow-[var(--ss-shadow-pop)] backdrop-blur-xl"
      >
        {TABS.map(({ id, label, icon }) => {
          const selected = tab === id;
          return (
            <motion.button
              key={id}
              layout
              transition={DOCK_SPRING}
              type="button"
              onClick={() => onChange(id)}
              title={label}
              aria-label={label}
              aria-current={selected ? 'page' : undefined}
              style={selected ? { color: 'var(--ss-primary-ink)' } : undefined}
              className={cx(
                'relative flex h-10 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:shadow-[0_0_0_2px_var(--ss-accent)]',
                selected ? 'gap-1.5 px-4' : 'w-10 text-ink-muted hover:text-ink',
              )}
            >
              {selected && (
                <motion.span
                  layoutId="dock-pill"
                  transition={DOCK_SPRING}
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full"
                  style={{ backgroundColor: 'var(--ss-primary)' }}
                />
              )}
              <span className="relative z-10">{icon}</span>
              {selected && (
                <motion.span
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.16, ease: 'easeOut' }}
                  className="relative z-10 text-xs font-semibold whitespace-nowrap"
                >
                  {label}
                </motion.span>
              )}
            </motion.button>
          );
        })}
      </motion.nav>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flat layout primitives — sections separated by hairlines, no card boxes.
// ---------------------------------------------------------------------------

function Panel({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line">{children}</div>;
}

function Group({
  title,
  description,
  action,
  children,
}: {
  title?: string;
  description?: string;
  /** Optional control rendered on the right edge of the section header. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="py-6 first:pt-0 last:pb-0">
      {title && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {description && (
              <p className="mt-1 text-[13px] leading-snug text-ink-muted">{description}</p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-1 text-[13px] leading-snug text-ink-muted">{description}</p>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------

function AccountPanel({ auth }: { auth: AuthState | null }) {
  const [subView, setSubView] = useState<'list' | 'add'>('list');
  const [busyDid, setBusyDid] = useState<string | null>(null);

  if (!auth) {
    return (
      <div className="flex items-center gap-4 py-6" aria-hidden="true">
        <div className="size-14 shrink-0 rounded-full shimmer" />
        <div className="flex-1 space-y-2.5">
          <div className="h-4 w-40 rounded-md shimmer" />
          <div className="h-3.5 w-28 rounded-md shimmer" />
        </div>
      </div>
    );
  }

  if (auth.status === 'signed-out') {
    return (
      <div className="mx-auto max-w-sm pb-4 sm:mx-0">
        <div className="mb-6 pt-2 text-center sm:pt-0 sm:text-left">
          <h2 className="text-xl font-semibold tracking-tight text-ink sm:text-[15px]">Sign in</h2>
          <p className="mt-1.5 text-[13px] leading-snug text-ink-muted sm:mt-1">
            Connect your Bluesky account to start posting.
          </p>
        </div>
        <LoginView />
      </div>
    );
  }

  const { account, accounts } = auth;
  // Active account first so it's easy to spot, then the rest in order.
  const orderedAccounts = [account, ...accounts.filter((item) => item.did !== account.did)];

  function signOut(did: string) {
    setBusyDid(did);
    void sendMessage('auth:logout', { did })
      .catch(() => undefined)
      .finally(() => setBusyDid(null));
  }

  if (subView === 'add') {
    return (
      <Panel>
        <Group>
          <div className="mx-auto max-w-sm pb-4 sm:mx-0">
            <div className="mb-4 flex items-center gap-1.5 text-[15px] font-semibold">
              <button
                type="button"
                onClick={() => setSubView('list')}
                className="text-ink-muted hover:text-ink transition-colors cursor-pointer"
              >
                Accounts
              </button>
              <span className="text-ink-faint">/</span>
              <span className="text-ink">Add account</span>
            </div>
            <LoginView onSignedIn={() => setSubView('list')} />
          </div>
        </Group>
      </Panel>
    );
  }

  return (
    <Panel>
      <Group
        title="Accounts"
        action={
          accounts.length < MAX_ACCOUNTS ? (
            <button
              type="button"
              onClick={() => setSubView('add')}
              className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-accent-soft px-3.5 text-xs font-semibold text-accent transition-all hover:opacity-85 active:scale-95"
            >
              <UserRoundPlusIcon size={14} />
              Add
            </button>
          ) : undefined
        }
      >
        <div className="divide-y divide-line">
          {orderedAccounts.map((item) => {
            const active = item.did === account.did;
            return (
              <div key={item.did} className="flex items-center gap-3 py-3 first:pt-0">
                <Avatar src={item.avatar} name={item.displayName ?? item.handle} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[13px] font-semibold text-ink">
                      {item.displayName ?? item.handle}
                    </p>
                    {active && (
                      <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-ink-muted">
                    @{item.handle}
                    <span className="text-ink-faint"> · {new URL(item.service).host}</span>
                  </p>
                </div>
                <IconButton
                  title={`Sign out @${item.handle}`}
                  className="size-7 text-ink-faint hover:bg-danger-soft hover:text-danger"
                  disabled={busyDid === item.did}
                  onClick={() => signOut(item.did)}
                >
                  <LogOutIcon size={14} />
                </IconButton>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex items-start gap-3 border-t border-line/50 pt-5">
          <InfoIcon size={16} className="mt-0.5 shrink-0 text-accent" />
          <p className="text-[13px] leading-relaxed text-ink-muted">
            You’re signed in with app passwords. Session tokens are stored only on this device and
            can be revoked anytime from{' '}
            <a
              className="font-medium text-accent hover:underline"
              href="https://bsky.app/settings/app-passwords"
              target="_blank"
              rel="noreferrer"
            >
              Bluesky’s app password settings
            </a>
            .
          </p>
        </div>
      </Group>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

const THEME_OPTIONS: Array<{ value: ThemePref; label: string; icon: ReactNode }> = [
  { value: 'system', label: 'System', icon: <MonitorIcon size={15} /> },
  { value: 'light', label: 'Light', icon: <SunIcon size={15} /> },
  { value: 'dark', label: 'Dark', icon: <MoonIcon size={15} /> },
];

function ThemeSwatch({ value }: { value: ThemePref }) {
  const light = (
    <div className="h-full w-full bg-[#eef1fb] p-2">
      <div className="h-2 w-3/5 rounded-sm bg-[#0b0f2b]/80" />
      <div className="mt-1.5 h-6 rounded-md border border-[#dce2f1] bg-white" />
    </div>
  );
  const dark = (
    <div className="h-full w-full bg-[#080b24] p-2">
      <div className="h-2 w-3/5 rounded-sm bg-[#eef1fe]/85" />
      <div className="mt-1.5 h-6 rounded-md border border-[#283167] bg-[#10163c]" />
    </div>
  );
  if (value === 'light') return light;
  if (value === 'dark') return dark;
  return (
    <div className="flex h-full w-full">
      <div className="w-1/2 overflow-hidden">{light}</div>
      <div className="w-1/2 overflow-hidden">{dark}</div>
    </div>
  );
}

function AppearancePanel({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}) {
  return (
    <Panel>
      <Group title="Theme" description="How SuperSky looks in the popup and settings.">
        <div className="grid grid-cols-3 gap-3">
          {THEME_OPTIONS.map(({ value, label, icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => update({ theme: value })}
              aria-pressed={settings.theme === value}
              className={cx(
                'cursor-pointer rounded-2xl border p-1.5 pb-2 transition-colors',
                settings.theme === value
                  ? 'border-accent'
                  : 'border-line hover:border-line-strong',
              )}
            >
              <div className="h-16 overflow-hidden rounded-xl border border-line">
                <ThemeSwatch value={value} />
              </div>
              <span
                className={cx(
                  'mt-2 flex items-center justify-center gap-1.5 text-[13px]',
                  settings.theme === value ? 'font-medium text-accent' : 'text-ink-muted',
                )}
              >
                {icon}
                {label}
              </span>
            </button>
          ))}
        </div>
      </Group>

      <Group title="Accent color" description="Tints buttons, links, toggles, and the badge.">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {ACCENTS.map((a) => {
            const selected = settings.accent === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => update({ accent: a.id })}
                aria-pressed={selected}
                className={cx(
                  'flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-all',
                  selected ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong',
                )}
              >
                <span
                  className="size-6 shrink-0 rounded-full ring-1 ring-black/5"
                  style={{ backgroundImage: `linear-gradient(135deg, ${a.from}, ${a.to})` }}
                />
                <span
                  className={cx('text-[13px]', selected ? 'font-medium text-ink' : 'text-ink-muted')}
                >
                  {a.label}
                </span>
                {selected && <CheckIcon size={15} className="ml-auto shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      </Group>

    </Panel>
  );
}

// ---------------------------------------------------------------------------

function NotificationsPanel({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}) {
  const [permission, setPermission] = useState<'granted' | 'denied' | 'unknown'>('unknown');
  const [tested, setTested] = useState(false);

  useEffect(() => {
    sendMessage('notif:status', undefined)
      .then((status) => setPermission(status.permission))
      .catch(() => undefined);
  }, []);

  function sendTest() {
    void sendMessage('notif:test', undefined)
      .then(async () => {
        setTested(true);
        // Re-check afterwards: a blocked test is the moment to surface why.
        const status = await sendMessage('notif:status', undefined);
        setPermission(status.permission);
      })
      .catch(() => undefined);
  }

  return (
    <Panel>
      <Group>
        <div className="space-y-5">
          <SettingRow
            title="Notification badge"
            description="Show your unread Bluesky notification count on the toolbar icon."
          >
            <Switch
              checked={settings.showBadge}
              onChange={(v) => update({ showBadge: v })}
              label="Notification badge"
            />
          </SettingRow>
          <SettingRow
            title="Notification banners"
            description="Pop up a desktop banner when your active account gets new likes, replies, mentions, reposts, and follows."
          >
            <Switch
              checked={settings.showBanners}
              onChange={(v) => update({ showBanners: v })}
              label="Notification banners"
            />
          </SettingRow>
        </div>
      </Group>

      {permission === 'denied' && (
        <Group>
          <div className="flex items-start gap-3">
            <AlertCircleIcon size={16} className="mt-0.5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-relaxed text-ink-muted">
                Your browser is currently blocking SuperSky’s banners. Allow them in its
                notification settings, then send another test.
              </p>
              <Button
                variant="outline"
                className="mt-3 h-9 gap-1.5 px-4 text-[13px]"
                onClick={() => {
                  void browser.tabs
                    .create({ url: 'chrome://settings/content/notifications' })
                    .catch(() => undefined);
                }}
              >
                <ExternalLinkIcon size={13} /> Open browser notification settings
              </Button>
            </div>
          </div>
        </Group>
      )}

      <Group title="Not seeing banners?">
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Banners only announce activity that happens <em>after</em> they’re switched on — your
          existing backlog stays quiet. New activity is checked about every 15 seconds. Fire a test
          to confirm banners reach your screen:
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="outline" className="h-9 gap-1.5 px-4 text-[13px]" onClick={sendTest}>
            <BellIcon size={14} /> Send a test banner
          </Button>
          {tested && (
            <span className="text-xs text-ink-faint">Sent — check the corner of your screen.</span>
          )}
        </div>
        {tested && (
          <div className="mt-4">
            <p className="text-[13px] leading-relaxed text-ink-muted">
              Didn’t see it? Your system may be muting the browser — make sure its notifications
              are allowed and Do Not Disturb is off.
            </p>
            {OS_NOTIFICATION_SETTINGS && (
              <Button
                variant="outline"
                className="mt-3 h-9 gap-1.5 px-4 text-[13px]"
                onClick={() => {
                  // Deep link into the OS Settings app; the browser asks for
                  // confirmation and the page stays put.
                  window.location.href = OS_NOTIFICATION_SETTINGS.url;
                }}
              >
                <ExternalLinkIcon size={13} /> {OS_NOTIFICATION_SETTINGS.label}
              </Button>
            )}
          </div>
        )}
      </Group>
    </Panel>
  );
}

/** Deep link to the OS notification settings, where one exists. */
const OS_NOTIFICATION_SETTINGS = navigator.userAgent.includes('Windows')
  ? { label: 'Open Windows notification settings', url: 'ms-settings:notifications' }
  : navigator.userAgent.includes('Mac OS')
    ? {
        label: 'Open macOS notification settings',
        url: 'x-apple.systempreferences:com.apple.preference.notifications',
      }
    : null;

// ---------------------------------------------------------------------------

function PostingPanel({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}) {
  return (
    <Panel>
      <Group>
        <SettingRow
          title="Default language"
          description="Tagged on new posts so readers can filter by language."
        >
          <Select
            value={settings.defaultLang}
            options={LANGUAGES}
            onChange={(value) => update({ defaultLang: value })}
            ariaLabel="Default post language"
            align="end"
            triggerClassName="h-9 w-44"
          />
        </SettingRow>
      </Group>
      <Group>
        <SettingRow
          title="Automatic link previews"
          description="Turn the first link in a post into a rich card, like the official app."
        >
          <Switch
            checked={settings.autoLinkCard}
            onChange={(v) => update({ autoLinkCard: v })}
            label="Automatic link previews"
          />
        </SettingRow>
      </Group>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

const ABOUT_LINKS = [
  { label: 'Bluesky', href: 'https://bsky.app' },
  { label: 'AT Protocol OAuth spec', href: 'https://atproto.com/specs/oauth' },
  { label: 'App passwords', href: 'https://bsky.app/settings/app-passwords' },
];

const FEATURES = [
  'One-click composer in your toolbar',
  'Multiple accounts, one draft to many',
  '@-mention autocomplete',
  'Share pages, links & quotes',
  'Images with alt text, link cards',
  'Notification badge & banner alerts',
];

function AboutPanel() {
  return (
    <Panel>
      <Group>
        <p className="text-sm font-medium text-ink">Post to Bluesky at the speed of light.</p>
        <p className="mt-1 text-[13px] leading-snug text-ink-muted">
          Everything happens right in your toolbar, and your drafts and sessions stay on this
          device.
        </p>
        <ul className="mt-5 grid gap-2.5 text-[13px] text-ink-muted sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <li key={feature} className="flex items-center gap-2">
              <SparkleIcon size={13} className="shrink-0 text-accent" />
              {feature}
            </li>
          ))}
        </ul>
      </Group>

      <Group title="Privacy">
        <p className="text-[13px] leading-relaxed text-ink-muted">
          SuperSky has no server and no analytics. The extension talks only to your PDS (for
          posting) and Bluesky’s link-preview service. Credentials and drafts never leave your
          browser.
        </p>
      </Group>

      <Group title="Roadmap">
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Threads, post scheduling, and OAuth sign-in (once hosted client metadata is set up) are
          planned. Follow along and suggest features anytime.
        </p>
        <div className="mt-3.5 flex flex-wrap gap-2">
          {ABOUT_LINKS.map((link) => (
            <a
              key={link.href}
              className="btn btn-outline h-8 gap-1.5 px-3.5 text-xs"
              href={link.href}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLinkIcon size={13} /> {link.label}
            </a>
          ))}
        </div>
      </Group>
    </Panel>
  );
}
