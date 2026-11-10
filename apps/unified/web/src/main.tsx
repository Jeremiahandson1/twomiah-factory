import React from 'react'
import ReactDOM from 'react-dom/client'
import { applyStoredTheme, setTrialBypassPaths } from './shared'
import App from './App'
import { LOCK_WAYS_OUT } from './lockPaths'
import { verticalScreens } from './crm/vertical'
import { registerCodeWords } from '@twomiah/tenant-ui/src/labels/codes'
import { registerVocabulary } from '@twomiah/tenant-ui/src/labels/vocabulary'
import { registerTextApi } from '@twomiah/tenant-ui/src/text/record'
import { api } from './api'
import { reloadForNewBuild } from '@twomiah/tenant-ui/src/shell/staleBuild'
import './index.css'

// A screen's script from the release before this one (the site updated while the page was open): load the page again, once
// (shell/ErrorBoundary.tsx reloadForNewBuild — store live test 11/10).
window.addEventListener('vite:preloadError', (e) => { if (reloadForNewBuild()) e.preventDefault() })

// The saved theme and colour on <html> before the first render: the sign-in pages render outside the shell, which is
// what applies them otherwise.
applyStoredTheme()

// A locked company's ways out are this app's (./lockPaths.ts).
setTrialBypassPaths(LOCK_WAYS_OUT)

// The vertical's own words for its stored codes (VerticalSettings.screens.codeLabels), for every screen's codeLabel().
registerCodeWords(verticalScreens().codeLabels)
// What this business calls its customers, its work and its team (VerticalSettings.vocabulary), for every shared screen.
registerVocabulary(verticalScreens().vocabulary)
// "Text opened on your phone — not confirmed sent": a press of a Text button is recorded on its contact or lead (server/crm/textActivity.ts).
registerTextApi(api)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
