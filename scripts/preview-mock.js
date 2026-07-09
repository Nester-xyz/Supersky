// Mock of the chrome.* extension APIs used by SuperSky's pages, so the real
// built bundles can render in a plain browser tab for design iteration.
// Never shipped: only injected by scripts/preview-server.mjs.
(() => {
  const params = new URLSearchParams(location.search);
  const signedIn = params.get('state') !== 'login';

  const svgUri = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
  const AVATAR = svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#635bee"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><text x="32" y="41" font-family="system-ui" font-size="26" font-weight="700" fill="#fff" text-anchor="middle">N</text></svg>`,
  );
  const CARD_IMAGE = svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="315"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#161c4c"/><stop offset="1" stop-color="#0ea5c4"/></linearGradient></defs><rect width="600" height="315" fill="url(#g)"/><circle cx="470" cy="80" r="26" fill="#fff" opacity=".9"/></svg>`,
  );

  const ACCOUNT = {
    did: 'did:plc:preview',
    handle: 'nova.bsky.social',
    displayName: 'Nova Skywriter',
    avatar: AVATAR,
    service: 'https://bsky.social',
  };

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

  async function handleRequest(message) {
    const respond = (data) => ({ ok: true, data });
    switch (message.type) {
      case 'auth:get-state':
        await delay(150);
        return respond(signedIn ? { status: 'signed-in', account: ACCOUNT } : { status: 'signed-out' });
      case 'auth:login':
        await delay(700);
        return respond(ACCOUNT);
      case 'auth:logout':
        await delay(200);
        return respond(null);
      case 'card:fetch':
        await delay(600);
        return respond({
          url: message.payload.url,
          title: 'A Field Guide to the Night Sky',
          description:
            'Comets, constellations, and why we keep looking up — a long-form guide to reading the sky like a map.',
          imageUrl: CARD_IMAGE,
        });
      case 'post:publish':
        await delay(900);
        return respond({
          uri: 'at://did:plc:preview/app.bsky.feed.post/3preview',
          cid: 'bafypreview',
          webUrl: 'https://bsky.app/profile/nova.bsky.social/post/3preview',
        });
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
