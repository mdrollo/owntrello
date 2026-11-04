import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registrierung selbst in main.tsx (mit Update-Prüfung)
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'owntrello',
        short_name: 'owntrello',
        description: 'Boards mit Listen und Karten',
        lang: 'de',
        start_url: '/',
        display: 'standalone',
        background_color: '#1d2125',
        theme_color: '#0c66e4',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Neue Version sofort übernehmen, nicht warten, bis alle Tabs geschlossen sind
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // /api und die Anmeldung von Azure (/.auth/...) nie aus dem Cache bedienen
        navigateFallbackDenylist: [/^\/api\//, /^\/\.auth\//],
        runtimeCaching: [
          {
            // Letzte Board-Daten offline lesbar halten, online immer frisch holen.
            // Nicht: Live-Kanal (endloser Datenstrom) und Anhänge (groß, eigener Cache-Header).
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/') &&
              !url.pathname.endsWith('/events') &&
              !url.pathname.startsWith('/api/attachments/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'api', networkTimeoutSeconds: 5, cacheableResponse: { statuses: [200] } },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: { '/api': 'http://localhost:8080' },
  },
});
