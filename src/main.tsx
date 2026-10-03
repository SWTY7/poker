import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyLook, loadLook } from './game/settings'

// Before the first paint, so a saved look never flashes the default one.
applyLook(loadLook())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
