import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/fonts.css'
import './index.css'
import App from './App.tsx'
import { applyLook, loadLook } from './game/settings'
import { UpdateBanner } from './ui/UpdateBanner'
import { registerServiceWorker } from './pwa/register'

// Before the first paint, so a saved look never flashes the default one.
applyLook(loadLook())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <UpdateBanner />
  </StrictMode>,
)

registerServiceWorker()
