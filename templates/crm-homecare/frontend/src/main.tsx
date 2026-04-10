import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const rootEl = document.getElementById('root')!;
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Clear React 18's no-op onclick trap that can block event delegation
requestAnimationFrame(() => { if (rootEl.onclick) rootEl.onclick = null; });
