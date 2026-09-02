import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "logo-mark.png"],
      manifest: {
        name: "Hall Collins Real Estate Group",
        short_name: "Hall Collins",
        description: "Transaction dashboard for Hall Collins Real Estate Group",
        theme_color: "#173348",
        background_color: "#F7F5F0",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "logo-mark.png", sizes: "192x192", type: "image/png" },
          { src: "logo-mark.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
});
