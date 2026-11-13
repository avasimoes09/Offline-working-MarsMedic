import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const lanHost = process.env.LAN_HOST
const apiPort = process.env.API_PORT || '8787'
const tlsCertPath = process.env.TLS_CERT_PATH
const tlsKeyPath = process.env.TLS_KEY_PATH
if (lanHost && (!tlsCertPath || !tlsKeyPath)) {
  throw new Error('TLS_CERT_PATH and TLS_KEY_PATH are required when serving the app on the LAN.')
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    VitePWA({
      disable: mode === 'desktop',
      registerType: 'autoUpdate',
      includeAssets: ['mia.png'],
      manifest: {
        name: 'M. I. A.',
        short_name: 'M. I. A.',
        description: 'Offline patient health records and medical tools.',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/mia.png', sizes: '1024x1024', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{css,html,js,svg,ttf,webmanifest}'],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: lanHost || '127.0.0.1',
    ...(lanHost ? { allowedHosts: [lanHost] } : {}),
    ...(lanHost ? {
      https: {
        cert: readFileSync(tlsCertPath),
        key: readFileSync(tlsKeyPath),
      },
    } : {}),
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
    },
  },
}));
