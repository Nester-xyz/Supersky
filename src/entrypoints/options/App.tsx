import { useEffect, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { LoginView } from '@/components/auth/LoginView';
import {
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
} from '@/components/icons';
import { LogoMark } from '@/components/Logo';
import { Avatar, Button, Switch, cx } from '@/components/ui';
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
import type { AuthState } from '@/lib/types';

type TabId = 'account' | 'appearance' | 'posting' | 'about';

const TABS: Array<{ id: TabId; label: string; icon: ReactNode }> = [
  { id: 'account', label: 'Account', icon: <UserIcon size={16} /> },
  { id: 'appearance', label: 'Appearance', icon: <SunIcon size={16} /> },
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
    if (auth) writeAuthCache(auth.status === 'signed-in' ? 'in' : 'out');
  }, [auth]);

  function update(patch: Partial<Settings>) {
    setSettings((prev) => ({ ...prev, ...patch }));
    void saveSettings(patch);
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-3xl px-6 pt-10 pb-16">
        <header className="mb-8 flex items-center gap-3.5">
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

        <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
          <nav className="flex shrink-0 gap-1 overflow-x-auto sm:w-44 sm:flex-col">
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
            {tab === 'account' && <AccountPanel auth={auth} />}
            {tab === 'appearance' && <AppearancePanel settings={settings} update={update} />}
            {tab === 'posting' && <PostingPanel settings={settings} update={update} />}
            {tab === 'about' && <AboutPanel />}
          </main>
        </div>
      </div>
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
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="py-6 first:pt-0 last:pb-0">
      {title && (
        <div className="mb-4">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {description && (
            <p className="mt-1 text-[13px] leading-snug text-ink-muted">{description}</p>
          )}
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
  const [signingOut, setSigningOut] = useState(false);

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
      <div className="mx-auto max-w-sm pt-2 pb-4">
        <LoginView />
      </div>
    );
  }

  const { account } = auth;
  return (
    <Panel>
      <Group>
        <div className="flex items-center gap-4">
          <Avatar src={account.avatar} name={account.displayName ?? account.handle} size={56} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-ink">
              {account.displayName ?? account.handle}
            </p>
            <p className="truncate text-sm text-ink-muted">@{account.handle}</p>
            <p className="mt-1.5 inline-flex rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-faint">
              {new URL(account.service).host}
            </p>
          </div>
          <Button
            variant="danger-outline"
            loading={signingOut}
            onClick={() => {
              setSigningOut(true);
              void sendMessage('auth:logout', undefined).finally(() => setSigningOut(false));
            }}
          >
            <LogOutIcon size={15} />
            Sign out
          </Button>
        </div>
      </Group>

      <Group>
        <div className="flex items-start gap-3">
          <InfoIcon size={16} className="mt-0.5 shrink-0 text-accent" />
          <p className="text-[13px] leading-relaxed text-ink-muted">
            You’re signed in with an app password. Session tokens are stored only on this device and
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
                'cursor-pointer rounded-2xl border-2 p-1.5 pb-2 transition-colors',
                settings.theme === value ? 'border-accent' : 'border-line hover:border-line-strong',
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
                  'flex cursor-pointer items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 transition-colors',
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

      <Group>
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
      </Group>
    </Panel>
  );
}

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
          <select
            value={settings.defaultLang}
            onChange={(e) => update({ defaultLang: e.target.value })}
            className="input h-9 w-44 cursor-pointer"
          >
            {LANGUAGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
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
  'Share pages, links & quotes',
  'Images with alt text, link cards',
  'Unread notification badge',
];

function AboutPanel() {
  return (
    <Panel>
      <Group>
        <div className="flex items-center gap-4">
          <LogoMark size={52} />
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              Super
              <span className="text-gradient">Sky</span>
            </h2>
            <p className="text-sm text-ink-muted">Post to Bluesky at the speed of light.</p>
          </div>
        </div>
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
          Threads, post scheduling, multi-account, and OAuth sign-in (once hosted client metadata is
          set up) are planned. Follow along and suggest features anytime.
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
