import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import posthog from 'posthog-js'
import './index.css'
import App from './App.tsx'

posthog.init('phc_sufeGJm8CBKYMtWLScMa5XPE7G7caX36oaBwcGKEk3xo', {
  api_host: 'https://us.i.posthog.com',
  capture_pageview: true,
  session_recording: {
    maskAllInputs: true,
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)