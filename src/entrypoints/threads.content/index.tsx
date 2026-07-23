import ReactDOM from 'react-dom/client';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { CrossPostApp } from '@/components/CrossPostApp';
import { watchForMainThreadsPosts } from '@/lib/threadsdetect';

/**
 * The cross-post suggester on Threads: after the user publishes a main post
 * there, the same toast + lite composer offers to post it on Bluesky too.
 * Rendered in a shadow root so Threads' styles and ours never mix. threads.net
 * is the legacy domain and still resolves, so both are matched.
 */
export default defineContentScript({
  matches: ['*://*.threads.com/*', '*://*.threads.net/*'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'supersky-crosspost',
      position: 'inline',
      anchor: 'body',
      onMount(container) {
        // Keep our card's keystrokes from reaching Threads' global hotkeys.
        for (const type of ['keydown', 'keyup', 'keypress'] as const) {
          container.addEventListener(type, (event) => event.stopPropagation());
        }
        const root = ReactDOM.createRoot(container);
        root.render(<CrossPostApp watch={watchForMainThreadsPosts} videoName="threads-video" />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
