import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { fetchSessionFromServer, rememberClaimed, resolveSession } from './lib/session'

// On the Catalyst deployment a signed-out browser goes to Catalyst's login page before the app starts.
// Everywhere else (and on any failure) this is a no-op and the app starts as before.
void resolveSession(fetchSessionFromServer).then((outcome) => {
  if (outcome.kind === 'login') {
    window.location.assign(outcome.url)
    return
  }
  rememberClaimed(outcome.session?.claimed)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
