import { AtpAgent, type AtpSessionData, type AtpSessionEvent } from '@atproto/api';
import { browser } from 'wxt/browser';
import { friendlyAuthError, httpStatus } from '../errors';
import { MAX_ACCOUNTS, type AccountSnapshot, type AuthState, type LoginRequest } from '../types';

const ACCOUNTS_KEY = 'supersky:accounts';
const ACTIVE_KEY = 'supersky:active-did';
// Single-session keys from before multi-account; migrated on first read.
const LEGACY_SESSION_KEY = 'supersky:session';
const LEGACY_PROFILE_KEY = 'supersky:profile';

/** One signed-in identity: its PDS session, service URL, and cached profile. */
interface StoredAccount {
  did: string;
  session: AtpSessionData;
  service: string;
  profile: AccountSnapshot;
}

type AccountsMap = Record<string, StoredAccount>;

/**
 * Agents live as long as the service worker does; storage.local is the source
 * of truth across worker restarts. One agent per signed-in DID, resumed lazily.
 * Credentials never leave the device; only the session tokens issued by each
 * user's own PDS are stored.
 */
const agents = new Map<string, Promise<AtpAgent | null>>();

/** Notified with a fresh snapshot whenever accounts or the active one change. */
let onChange: ((state: AuthState) => void) | null = null;
export function setOnAuthChanged(callback: (state: AuthState) => void): void {
  onChange = callback;
}

async function emitChange(): Promise<void> {
  if (onChange) onChange(await buildStoredAuthState());
}

// -- serialized writes ------------------------------------------------------
// All account mutations read-modify-write shared storage keys; chaining them
// keeps concurrent token refreshes and switches from clobbering each other.
let writeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function createAgent(service: string): AtpAgent {
  return new AtpAgent({
    service,
    persistSession: (event: AtpSessionEvent, session?: AtpSessionData) => {
      if ((event === 'create' || event === 'update') && session) {
        void serialize(async () => {
          const { accounts, activeDid } = await readStore();
          const existing = accounts[session.did];
          accounts[session.did] = {
            did: session.did,
            session,
            service,
            profile: existing?.profile ?? { did: session.did, handle: session.handle, service },
          };
          await writeStore(accounts, activeDid ?? session.did);
        }).then(emitChange);
      } else if ((event === 'expired' || event === 'create-failed') && session?.did) {
        // Tokens are dead beyond refresh, so drop just this identity.
        void removeAccount(session.did);
      }
      // 'network-error' keeps the stored session; it may still be valid.
    },
  });
}

export async function login(request: LoginRequest): Promise<AccountSnapshot> {
  const agent = createAgent(request.service);
  const knownDids = Object.keys((await readStore()).accounts);
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
  const session = agent.session;
  if (!session) throw new Error('Sign-in did not establish a session. Please try again.');
  const did = session.did;

  // Cap the number of accounts. Re-signing an existing one is always allowed;
  // a brand-new one over the limit is rolled back (login already persisted it).
  if (!knownDids.includes(did) && knownDids.length >= MAX_ACCOUNTS) {
    try {
      await agent.logout();
    } catch {
      // Best-effort token revocation; storage is cleaned up regardless.
    }
    await serialize(async () => {
      const { accounts, activeDid } = await readStore();
      delete accounts[did];
      await writeStore(accounts, activeDid === did ? (knownDids[0] ?? null) : activeDid);
    });
    await emitChange();
    throw new Error(
      `You can stay signed in to ${MAX_ACCOUNTS} accounts at once. Sign out of one to add another.`,
    );
  }

  agents.set(did, Promise.resolve(agent));
  // Upsert the account and make it the one we post as.
  await serialize(async () => {
    const { accounts } = await readStore();
    const existing = accounts[did];
    accounts[did] = {
      did,
      session,
      service: request.service,
      profile: existing?.profile ?? { did, handle: session.handle, service: request.service },
    };
    await writeStore(accounts, did);
  });
  const account = await refreshProfileSnapshot(agent, request.service);
  await emitChange();
  return account;
}

/** Make an already-signed-in account the one new posts are attributed to. */
export async function switchAccount(did: string): Promise<AuthState> {
  await serialize(async () => {
    const { accounts } = await readStore();
    if (!accounts[did]) throw new Error('That account is no longer signed in.');
    await writeStore(accounts, did);
  });
  void getAgentForDid(did); // warm it so the first post is instant
  const state = await buildStoredAuthState();
  onChange?.(state);
  return state;
}

/** Sign out one account (defaults to the active one) and return the new state. */
export async function logout(did?: string): Promise<AuthState> {
  const target = did ?? (await readStore()).activeDid;
  if (target) await removeAccount(target);
  return buildStoredAuthState();
}

async function removeAccount(did: string): Promise<void> {
  const pending = agents.get(did);
  agents.delete(did);
  const agent = await pending?.catch(() => null);
  if (agent) {
    try {
      await agent.logout();
    } catch {
      // Token revocation is best-effort; local state is cleared regardless.
    }
  }
  await serialize(async () => {
    const { accounts, activeDid } = await readStore();
    if (!accounts[did]) return;
    delete accounts[did];
    const nextActive = activeDid === did ? (Object.keys(accounts)[0] ?? null) : activeDid;
    await writeStore(accounts, nextActive);
  });
  await emitChange();
}

/** The agent for the active (posting) account, or null when signed out. */
export async function getAgent(): Promise<AtpAgent | null> {
  const { activeDid } = await readStore();
  return activeDid ? getAgentForDid(activeDid) : null;
}

export async function requireAgent(): Promise<AtpAgent> {
  const agent = await getAgent();
  if (!agent) throw new Error('You’re signed out. Open the popup and sign in first.');
  return agent;
}

export function getAgentForDid(did: string): Promise<AtpAgent | null> {
  let pending = agents.get(did);
  if (!pending) {
    pending = resumeAccount(did);
    agents.set(did, pending);
    // A transient failure should not poison the cache; allow a retry.
    pending.catch(() => agents.delete(did));
  }
  return pending;
}

export async function requireAgentForDid(did: string): Promise<AtpAgent> {
  const agent = await getAgentForDid(did);
  if (!agent) throw new Error('That account is signed out. Sign in again to post as it.');
  return agent;
}

async function resumeAccount(did: string): Promise<AtpAgent | null> {
  const { accounts } = await readStore();
  const stored = accounts[did];
  if (!stored) return null;
  const agent = createAgent(stored.service);
  try {
    await agent.resumeSession(stored.session);
  } catch (err) {
    const status = httpStatus(err);
    if (status === 400 || status === 401) {
      // Tokens were revoked or expired beyond refresh, so sign this one out cleanly.
      await removeAccount(did);
      return null;
    }
    throw new Error('Could not reach your PDS. Check your connection and try again.');
  }
  return agent;
}

export async function getAuthState(): Promise<AuthState> {
  const stored = await buildStoredAuthState();
  if (stored.status === 'signed-out') return stored;
  const { accounts, activeDid } = await readStore();
  const active = activeDid ? accounts[activeDid] : undefined;
  try {
    const agent = active ? await getAgentForDid(active.did) : null;
    // Return the cached identity instantly; refresh the active snapshot in the
    // background so a broadcast lands if the profile changed.
    if (agent && active) {
      void refreshProfileSnapshot(agent, active.service).catch(() => undefined);
    }
  } catch {
    // Offline with a stored session: present the cached identities as-is.
  }
  return stored;
}

/** Build the signed-in/out snapshot from storage alone, with no network. */
export async function buildStoredAuthState(): Promise<AuthState> {
  const { accounts, activeDid } = await readStore();
  const list = Object.values(accounts).map((entry) => entry.profile);
  if (list.length === 0 || !activeDid || !accounts[activeDid]) {
    return { status: 'signed-out' };
  }
  return { status: 'signed-in', account: accounts[activeDid].profile, accounts: list };
}

async function refreshProfileSnapshot(agent: AtpAgent, service: string): Promise<AccountSnapshot> {
  const did = agent.session?.did;
  if (!did) throw new Error('No active session.');
  const profile = await agent.getProfile({ actor: did });
  const account: AccountSnapshot = {
    did,
    handle: profile.data.handle,
    displayName: profile.data.displayName || undefined,
    avatar: profile.data.avatar || undefined,
    service,
  };
  let changed = false;
  await serialize(async () => {
    const { accounts, activeDid } = await readStore();
    const existing = accounts[did];
    if (!existing) return;
    if (JSON.stringify(existing.profile) === JSON.stringify(account)) return;
    accounts[did] = { ...existing, profile: account, service };
    await writeStore(accounts, activeDid);
    changed = true;
  });
  if (changed) await emitChange();
  return account;
}

// -- storage ----------------------------------------------------------------

async function readStore(): Promise<{ accounts: AccountsMap; activeDid: string | null }> {
  const stored = await browser.storage.local.get([
    ACCOUNTS_KEY,
    ACTIVE_KEY,
    LEGACY_SESSION_KEY,
    LEGACY_PROFILE_KEY,
  ]);
  let accounts = (stored[ACCOUNTS_KEY] as AccountsMap | undefined) ?? {};
  let activeDid = (stored[ACTIVE_KEY] as string | undefined) ?? null;

  // Migrate a pre-multi-account single session into the new shape once.
  const legacy = stored[LEGACY_SESSION_KEY] as
    | { session: AtpSessionData; service: string }
    | undefined;
  if (Object.keys(accounts).length === 0 && legacy?.session) {
    const { session, service } = legacy;
    const profile = stored[LEGACY_PROFILE_KEY] as AccountSnapshot | undefined;
    accounts = {
      [session.did]: {
        did: session.did,
        session,
        service,
        profile: profile ?? { did: session.did, handle: session.handle, service },
      },
    };
    activeDid = session.did;
    await browser.storage.local.set({ [ACCOUNTS_KEY]: accounts, [ACTIVE_KEY]: activeDid });
    await browser.storage.local.remove([LEGACY_SESSION_KEY, LEGACY_PROFILE_KEY]);
  }

  // Repair a dangling active pointer so the UI never points at a missing account.
  if (activeDid && !accounts[activeDid]) activeDid = null;
  if (!activeDid) activeDid = Object.keys(accounts)[0] ?? null;

  return { accounts, activeDid };
}

async function writeStore(accounts: AccountsMap, activeDid: string | null): Promise<void> {
  await browser.storage.local.set({ [ACCOUNTS_KEY]: accounts, [ACTIVE_KEY]: activeDid });
}
