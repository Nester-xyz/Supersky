import { AtpAgent, type AtpSessionData, type AtpSessionEvent } from '@atproto/api';
import { browser } from 'wxt/browser';
import { friendlyAuthError, httpStatus } from '../errors';
import type { AccountSnapshot, AuthState, LoginRequest } from '../types';

const SESSION_KEY = 'supersky:session';
const PROFILE_KEY = 'supersky:profile';

interface StoredSession {
  session: AtpSessionData;
  service: string;
}

/**
 * The agent lives as long as the service worker does; storage.local is the
 * source of truth across worker restarts. Credentials never leave the device
 * — only the session tokens issued by the user's own PDS are stored.
 */
let agentPromise: Promise<AtpAgent | null> | null = null;

/** Hook for the background script to react when a session is invalidated. */
let onSessionCleared: (() => void) | null = null;
export function setOnSessionCleared(callback: () => void): void {
  onSessionCleared = callback;
}

/** Hook for the background script to react when the profile snapshot updates. */
let onProfileUpdated: ((account: AccountSnapshot) => void) | null = null;
export function setOnProfileUpdated(callback: (account: AccountSnapshot) => void): void {
  onProfileUpdated = callback;
}

function createAgent(service: string): AtpAgent {
  return new AtpAgent({
    service,
    persistSession: (event: AtpSessionEvent, session?: AtpSessionData) => {
      if ((event === 'create' || event === 'update') && session) {
        void writeStoredSession({ session, service });
      } else if (event === 'expired' || event === 'create-failed') {
        void clearSession();
      }
      // 'network-error' keeps the stored session; it may still be valid.
    },
  });
}

export async function login(request: LoginRequest): Promise<AccountSnapshot> {
  const agent = createAgent(request.service);
  try {
    await agent.login({
      identifier: request.identifier,
      password: request.password,
      authFactorToken: request.authFactorToken || undefined,
    });
  } catch (err) {
    // Preserve the machine-readable code (e.g. AuthFactorTokenRequired) for the UI.
    const error = new Error(friendlyAuthError(err)) as Error & { error?: string };
    const code = (err as { error?: unknown }).error;
    if (typeof code === 'string') error.error = code;
    throw error;
  }
  agentPromise = Promise.resolve(agent);
  const account = await refreshProfileSnapshot(agent, request.service);
  return account;
}

export async function logout(): Promise<void> {
  const agent = await getAgent().catch(() => null);
  agentPromise = Promise.resolve(null);
  if (agent) {
    try {
      await agent.logout();
    } catch {
      // Token revocation is best-effort; local state is cleared regardless.
    }
  }
  await clearSession();
}

/**
 * Resolve the signed-in agent, resuming from storage after a service-worker
 * restart. Returns null when signed out; throws on transient network failure.
 */
export function getAgent(): Promise<AtpAgent | null> {
  if (!agentPromise) {
    agentPromise = resumeFromStorage();
    // A transient failure should not poison the cache; allow a retry.
    agentPromise.catch(() => {
      agentPromise = null;
    });
  }
  return agentPromise;
}

export async function requireAgent(): Promise<AtpAgent> {
  const agent = await getAgent();
  if (!agent) throw new Error('You’re signed out. Open the popup and sign in first.');
  return agent;
}

async function resumeFromStorage(): Promise<AtpAgent | null> {
  const stored = await readStoredSession();
  if (!stored) return null;
  const agent = createAgent(stored.service);
  try {
    await agent.resumeSession(stored.session);
  } catch (err) {
    const status = httpStatus(err);
    if (status === 400 || status === 401) {
      // Tokens were revoked or expired beyond refresh — sign out cleanly.
      await clearSession();
      return null;
    }
    throw new Error('Could not reach your PDS. Check your connection and try again.');
  }
  return agent;
}

export async function getAuthState(): Promise<AuthState> {
  const cached = await readProfileSnapshot();
  let agent: AtpAgent | null;
  try {
    agent = await getAgent();
  } catch {
    // Offline but with a stored session: present the cached identity.
    return cached ? { status: 'signed-in', account: cached } : { status: 'signed-out' };
  }
  if (!agent) return { status: 'signed-out' };

  const service = (await readStoredSession())?.service ?? '';
  if (cached) {
    // Return instantly; refresh the snapshot in the background.
    void refreshProfileSnapshot(agent, service).catch(() => undefined);
    return { status: 'signed-in', account: cached };
  }
  const account = await refreshProfileSnapshot(agent, service);
  return { status: 'signed-in', account };
}

async function refreshProfileSnapshot(agent: AtpAgent, service: string): Promise<AccountSnapshot> {
  const did = agent.session?.did;
  if (!did) throw new Error('No active session.');
  const previous = await readProfileSnapshot();
  const profile = await agent.getProfile({ actor: did });
  const account: AccountSnapshot = {
    did,
    handle: profile.data.handle,
    displayName: profile.data.displayName || undefined,
    avatar: profile.data.avatar || undefined,
    service,
  };
  await browser.storage.local.set({ [PROFILE_KEY]: account });
  if (JSON.stringify(previous) !== JSON.stringify(account)) {
    onProfileUpdated?.(account);
  }
  return account;
}

async function readStoredSession(): Promise<StoredSession | null> {
  const stored = await browser.storage.local.get(SESSION_KEY);
  return (stored[SESSION_KEY] as StoredSession | undefined) ?? null;
}

async function writeStoredSession(value: StoredSession): Promise<void> {
  await browser.storage.local.set({ [SESSION_KEY]: value });
}

async function readProfileSnapshot(): Promise<AccountSnapshot | null> {
  const stored = await browser.storage.local.get(PROFILE_KEY);
  return (stored[PROFILE_KEY] as AccountSnapshot | undefined) ?? null;
}

async function clearSession(): Promise<void> {
  agentPromise = Promise.resolve(null);
  await browser.storage.local.remove([SESSION_KEY, PROFILE_KEY]);
  onSessionCleared?.();
}
