import React from 'react';
import ReactDOM from 'react-dom/client';
import { initPageTheme } from '@/lib/theme';
import '@/styles/options.css';
import App from './App';

initPageTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
