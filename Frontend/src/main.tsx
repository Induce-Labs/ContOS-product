import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initI18n } from './i18n'
import { initGlitchtip, reactRootErrorHandlers } from './lib/glitchtip'

initGlitchtip()

async function bootstrap() {
  await initI18n()

  createRoot(document.getElementById('root')!, reactRootErrorHandlers()).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
