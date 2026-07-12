// Mock of the chrome.* extension APIs used by SuperSky's pages, so the real
// built bundles can render in a plain browser tab for design iteration.
// Never shipped: only injected by scripts/preview-server.mjs.
//
//   ?state=login       sign-in screen
//   ?accounts=1|2|3    how many accounts are signed in (default 2)
(() => {
  const params = new URLSearchParams(location.search);
  const signedIn = params.get('state') !== 'login';
  const accountCount = Math.max(1, Math.min(3, Number(params.get('accounts') ?? 2)));

  // Seed the synchronous auth hint so the popup renders instead of redirecting.
  try {
    localStorage.setItem('supersky:auth', signedIn ? 'in' : 'out');
  } catch {
    // localStorage may be unavailable; the async check still corrects things.
  }

  const svgUri = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
  const avatar = (letter, from, to) =>
    svgUri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><text x="32" y="43" font-family="system-ui" font-size="30" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`,
    );
  const CARD_IMAGE = svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="315"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#161c4c"/><stop offset="1" stop-color="#0ea5c4"/></linearGradient></defs><rect width="600" height="315" fill="url(#g)"/><circle cx="470" cy="80" r="26" fill="#fff" opacity=".9"/></svg>`,
  );

  const ALL_ACCOUNTS = [
    {
      did: 'did:plc:nova',
      handle: 'nova.bsky.social',
      displayName: 'Nova Skywriter',
      avatar: avatar('N', '#635bee', '#22d3ee'),
      service: 'https://bsky.social',
    },
    {
      did: 'did:plc:orion',
      handle: 'orion.bsky.social',
      displayName: 'Orion Vale',
      avatar: avatar('O', '#f43f5e', '#f59e0b'),
      service: 'https://bsky.social',
    },
    {
      did: 'did:plc:lyra',
      handle: 'lyra.example.com',
      displayName: 'Lyra Meridian',
      avatar: avatar('L', '#059669', '#14b8a6'),
      service: 'https://example.com',
    },
  ];

  let accounts = ALL_ACCOUNTS.slice(0, accountCount);
  let activeDid = accounts[0]?.did ?? null;

  const SUGGESTIONS = [
    {
      did: 'did:plc:a1',
      handle: 'alice.bsky.social',
      displayName: 'Alice Rivera',
      avatar: avatar('A', '#635bee', '#22d3ee'),
    },
    {
      did: 'did:plc:a2',
      handle: 'aldrin.bsky.social',
      displayName: 'Buzz Aldrin',
      avatar: avatar('B', '#f43f5e', '#f59e0b'),
    },
    {
      did: 'did:plc:a3',
      handle: 'altair.example.com',
      displayName: 'Altair Vega',
      avatar: avatar('A', '#059669', '#14b8a6'),
    },
    { did: 'did:plc:a4', handle: 'alpha.centauri.social', displayName: 'Alpha Centauri' },
  ];

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // --- storage --------------------------------------------------------------
  const changeListeners = [];
  function makeArea(areaName, initial = {}) {
    const data = { ...initial };
    const pick = (keys) => {
      if (keys == null) return { ...data };
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = {};
      for (const key of list) if (key in data) out[key] = data[key];
      return out;
    };
    return {
      async get(keys) {
        return pick(keys);
      },
      async set(items) {
        const changes = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: data[key], newValue: value };
          data[key] = value;
        }
        changeListeners.forEach((fn) => fn(changes, areaName));
      },
      async remove(keys) {
        const list = typeof keys === 'string' ? [keys] : keys;
        const changes = {};
        for (const key of list) {
          if (key in data) {
            changes[key] = { oldValue: data[key] };
            delete data[key];
          }
        }
        changeListeners.forEach((fn) => fn(changes, areaName));
      },
    };
  }

  // --- runtime messaging ----------------------------------------------------
  const messageListeners = [];

  function authState() {
    if (!signedIn || accounts.length === 0) return { status: 'signed-out' };
    const active = accounts.find((item) => item.did === activeDid) ?? accounts[0];
    return { status: 'signed-in', account: active, accounts };
  }

  function broadcastAuth() {
    const event = { __superskyEvent: true, kind: 'auth-changed', state: authState() };
    messageListeners.forEach((fn) => fn(event, {}, () => undefined));
  }

  async function handleRequest(message) {
    const respond = (data) => ({ ok: true, data });
    const payload = message.payload || {};
    switch (message.type) {
      case 'auth:get-state':
        await delay(140);
        return respond(authState());
      case 'auth:login':
        await delay(700);
        return respond(accounts[0]);
      case 'auth:switch':
        await delay(90);
        if (accounts.some((item) => item.did === payload.did)) activeDid = payload.did;
        broadcastAuth();
        return respond(authState());
      case 'auth:logout':
        await delay(200);
        accounts = accounts.filter((item) => item.did !== (payload.did ?? activeDid));
        if (!accounts.some((item) => item.did === activeDid)) activeDid = accounts[0]?.did ?? null;
        broadcastAuth();
        return respond(authState());
      case 'actor:search-typeahead': {
        await delay(180);
        const query = String(payload.query ?? '').toLowerCase();
        const matches = SUGGESTIONS.filter(
          (item) =>
            item.handle.toLowerCase().includes(query) ||
            (item.displayName ?? '').toLowerCase().includes(query),
        ).slice(0, payload.limit ?? 8);
        return respond(matches);
      }
      case 'card:fetch':
        await delay(600);
        return respond({
          url: payload.url,
          title: 'A Field Guide to the Night Sky',
          description:
            'Comets, constellations, and why we keep looking up — a long-form guide to reading the sky like a map.',
          imageUrl: CARD_IMAGE,
        });
      case 'post:publish': {
        await delay(900);
        const dids = payload.dids?.length ? payload.dids : [activeDid];
        return respond(
          dids.map((did) => {
            const account = accounts.find((item) => item.did === did) ?? accounts[0];
            return {
              uri: `at://${did}/app.bsky.feed.post/3preview`,
              cid: 'bafypreview',
              webUrl: `https://bsky.app/profile/${account.handle}/post/3preview`,
              handle: account.handle,
            };
          }),
        );
      }
      case 'badge:refresh':
        return respond(null);
      default:
        return { ok: false, error: `Unhandled message: ${message.type}` };
    }
  }

  const chrome = {
    storage: {
      local: makeArea('local'),
      sync: makeArea('sync'),
      session: makeArea('session'),
      onChanged: {
        addListener: (fn) => changeListeners.push(fn),
        removeListener: (fn) => {
          const i = changeListeners.indexOf(fn);
          if (i >= 0) changeListeners.splice(i, 1);
        },
      },
    },
    runtime: {
      getManifest: () => ({ version: '0.1.0-preview' }),
      getURL: (path) => path,
      openOptionsPage: async () => {
        location.href = '/options.html';
      },
      onMessage: {
        addListener: (fn) => messageListeners.push(fn),
        removeListener: (fn) => {
          const i = messageListeners.indexOf(fn);
          if (i >= 0) messageListeners.splice(i, 1);
        },
      },
      sendMessage: async (message) => {
        if (message && message.__supersky) return handleRequest(message);
        messageListeners.forEach((fn) => fn(message, {}, () => undefined));
        return undefined;
      },
    },
    tabs: {
      query: async () => [
        { url: 'https://example.com/night-sky-guide', title: 'A Field Guide to the Night Sky — Example' },
      ],
    },
    action: {
      setBadgeText: async () => undefined,
      setBadgeBackgroundColor: async () => undefined,
      setBadgeTextColor: async () => undefined,
    },
  };

  globalThis.chrome = chrome;
})();
