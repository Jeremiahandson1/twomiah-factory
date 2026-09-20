import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyStoredTheme } from './shared'
import './index.css'

// M4: roof shipped 173 dark: rules and nothing ever put the `dark` class on <html>, so every one of
// them was dead CSS and the theme could not be chosen. tailwind.config already said darkMode: 'class'
// and the shared hook was already re-exported here — only the wiring was missing.
//
// Applied before render, so a cold load of a saved dark theme does not flash light first.
applyStoredTheme();

const rootEl = document.getElementById('root')!;
ReactDOM.createRoot(rootEl).render(<React.StrictMode><App /></React.StrictMode>);

// Clear React 18's no-op onclick trap that can block event delegation
requestAnimationFrame(() => { if (rootEl.onclick) rootEl.onclick = null; });
