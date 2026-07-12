import React from 'react';
import ReactDOM from 'react-dom/client';
import { browser } from 'wxt/browser';
import { readAuthHint } from '@/lib/auth-cache';
import { initPageTheme } from '@/lib/theme';
import '@/styles/popup.css';
import App from './App';

const isWindowMode = new URLSearchParams(window.location.search).get('mode') === 'window';

if (!isWindowMode && readAuthHint() !== 'in') {
  // Known (or presumed) signed out: open the settings page — which hosts the
  // sign-in form — and close the popup WITHOUT rendering anything, so there is
  // no flash of popup content. The async session check on the settings page
  // corrects the cache if it was ever wrong.
  document.documentElement.classList.add('redirecting');
  void browser.runtime.openOptionsPage().finally(() => window.close());
} else {
  initPageTheme();
  if (isWindowMode) document.documentElement.classList.add('mode-window');
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
