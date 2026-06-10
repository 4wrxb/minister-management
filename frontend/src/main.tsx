import React from 'react'
import ReactDOM from 'react-dom/client'
import axios from 'axios'
import App from './App'
import './index.css'
import './i18n'
import { getAppBase } from './utils/appBase'

// Prefix all axios requests with the same URL sub-path the SPA is hosted at,
// read at runtime from <meta name="app-base"> (see backend/app.py inject_base_tag).
// Empty string when the app is at the root, which leaves URLs unchanged.
axios.defaults.baseURL = getAppBase()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
