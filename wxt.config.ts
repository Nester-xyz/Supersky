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
    name: 'SuperSky: Bluesky Composer',
    short_name: 'SuperSky',
    description:
      'Compose posts, share pages, and keep up with your Bluesky notifications right from your toolbar.',
    permissions: ['storage', 'alarms', 'contextMenus', 'activeTab'],
    host_permissions: ['https://cardyb.bsky.app/*'],
    commands: {
      _execute_action: {
        suggested_key: { default: 'Ctrl+Shift+S', mac: 'Command+Shift+S' },
        description: 'Open the SuperSky composer',
      },
    },
  },
});
