import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import './index.css'
import App from './App'

// Apply saved theme before first render — default to dark
const savedTheme = localStorage.getItem('theme') ?? 'dark'
document.documentElement.classList.toggle('dark', savedTheme === 'dark')

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <BrowserRouter>
            <App />
            <Toaster position="top-right" richColors />
        </BrowserRouter>
    </StrictMode>,
)
