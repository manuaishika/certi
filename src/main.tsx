import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import './i18n'
import './index.css'
import App from './App'
import { AuthProvider } from './lib/auth'
import { BrandingProvider } from './lib/branding'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        <BrandingProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrandingProvider>
      </BrowserRouter>
    </HelmetProvider>
  </React.StrictMode>,
)
