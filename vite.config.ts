import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons.svg"],
      manifest: {
        name: "跨境电商 Listing 智能生成台",
        short_name: "Listing台",
        description: "跨境电商多平台本土化 Listing 智能生成",
        theme_color: "#7c3aed",
        background_color: "#ffffff",
        display: "standalone",
        scope: "./",
        start_url: "./",
        icons: [
          { src: "favicon.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
          { src: "favicon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: { globPatterns: ["**/*.{js,css,html,svg,png,woff2}"] },
    }),
  ],
})