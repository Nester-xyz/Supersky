import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  publicDir: 'src/public',
  modules: ['@wxt-dev/module-react'],
  imports: false,
  outDirTemplate: '',
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
    action: {
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
      },
    },
    name: 'Supersky: Bluesky Composer',
    short_name: 'Supersky',
    description:
      'Compose posts, share pages, and keep up with your Bluesky notifications right from your toolbar.',
    // unlimitedStorage: saved drafts embed their images as base64, which can
    // exceed storage.local's default 10 MB quota.
    permissions: [
      'storage',
      'unlimitedStorage',
      'alarms',
      'contextMenus',
      'activeTab',
      'notifications',
    ],
    // cardyb: link-card previews; cdn: author avatars inlined into toasts
    // (the CDN sends no CORS headers, so plain fetch needs the host grant);
    // gifs + subdomains: GIF search proxy and its media CDN; video: direct
    // uploads to Bluesky's video processing service from the popup.
    host_permissions: [
      'https://cardyb.bsky.app/*',
      'https://cdn.bsky.app/*',
      'https://gifs.bsky.app/*',
      'https://*.gifs.bsky.app/*',
      'https://video.bsky.app/*',
    ],
    commands: {
      _execute_action: {
        suggested_key: { default: 'Ctrl+Shift+S', mac: 'Command+Shift+S' },
        description: 'Open the Supersky composer',
      },
    },
  },
});
