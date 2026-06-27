import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves from /<repo>/ unless using a custom domain or user/org page.
// Set BASE_PATH in the deploy workflow (e.g. "/boyle-bingo/"). Defaults to "/".
const base = process.env.BASE_PATH || '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', // service worker updates on new deploy
      includeAssets: ['favicon.svg', 'icon-192.svg', 'icon-512.svg'],
      manifest: {
        name: 'Boyle Bingo',
        short_name: 'Boyle Bingo',
        description: 'Prediction bingo for your group.',
        theme_color: '#1f2933',
        background_color: '#0b0f14',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: 'icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      },
      workbox: {
        // Network-first for everything so live game data is fresh; shell still
        // works offline from the precache fallback.
        navigateFallback: base + 'index.html',
        runtimeCaching: [
          {
            // Supabase API/storage: network-first so live data stays fresh.
            urlPattern: /^https:\/\/[^/]+\.supabase\.(co|in)\//,
            handler: 'NetworkFirst',
            options: { cacheName: 'supabase', networkTimeoutSeconds: 5 }
          }
        ]
      }
    })
  ]
})
