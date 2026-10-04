import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { fetchSessionFromServer, rememberClaimed, resolveSession, resolveStorageIdentity, resolveStorageWorkspace, confirmStorageIdentity } from './lib/session'
import { getActiveUserId, setActiveUserId, setActiveTaskWorkspace } from './lib/storage'
import { notesSyncService } from './services/notesSyncService'

// On the Catalyst deployment a signed-out browser goes to Catalyst's login page before the app starts.
// Everywhere else (and on any failure) this is a no-op and the app starts as before.
void resolveSession(fetchSessionFromServer).then(async (outcome) => {
  if (outcome.kind === 'login') {
    window.location.assign(outcome.url)
    return
  }
  setActiveUserId(await resolveStorageIdentity(outcome.session))
  setActiveTaskWorkspace(await resolveStorageWorkspace())
  await confirmStorageIdentity(getActiveUserId())
  notesSyncService.restorePending()
  rememberClaimed(outcome.session?.claimed)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}).catch(() => {
  document.getElementById('root')!.textContent = 'Unable to verify this workspace. Please retry when the server is available.'
})
