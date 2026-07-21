import ReactDOM from 'react-dom/client';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { CrossPostApp } from './CrossPostApp';
import './style.css';

/**
 * The cross-post suggester on X: after the user publishes a main post there,
 * a small toast offers to post it on Bluesky too, expanding into a lite
 * composer. Rendered in a shadow root so X's styles and ours never mix.
 */
export default defineContentScript({
  matches: ['*://x.com/*', '*://twitter.com/*'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'supersky-crosspost',
      position: 'inline',
      anchor: 'body',
      onMount(container) {
        // Keystrokes inside our card must not reach X's global hotkeys
        // (event retargeting makes them look like non-input keys to the page).
        for (const type of ['keydown', 'keyup', 'keypress'] as const) {
          container.addEventListener(type, (event) => event.stopPropagation());
        }
        const root = ReactDOM.createRoot(container);
        root.render(<CrossPostApp />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
