import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['ticket-one-icon.png'],
      manifest: {
        name: 'Ticket One — Scan',
        short_name: 'Scan',
        description: 'Gate scanning for Ticket One',
        theme_color: '#11161D',
        background_color: '#11161D',
        display: 'standalone',
        start_url: '/scan',
        icons: [
          { src: '/ticket-one-icon.png', sizes: '192x192', type: 'image/png' },
          { src: '/ticket-one-icon.png', sizes: '512x512', type: 'image/png' },
          { src: '/ticket-one-icon.png', sizes: 'any', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
