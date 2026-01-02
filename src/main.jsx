import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

function setViewportHeightVar() {
  const vh = (window.visualViewport && window.visualViewport.height)
    ? window.visualViewport.height
    : window.innerHeight
  document.documentElement.style.setProperty('--vh', `${vh}px`)
}
setViewportHeightVar()
window.addEventListener('resize', setViewportHeightVar)
window.addEventListener('orientationchange', () => setTimeout(setViewportHeightVar, 120))
if (window.visualViewport) window.visualViewport.addEventListener('resize', setViewportHeightVar)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
