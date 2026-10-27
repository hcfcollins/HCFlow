import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // icon-192/512.png are real, square, correctly-sized PNGs generated from
      // logo-mark.png — the old config pointed both manifest sizes at
      // logo-mark.png itself, which is actually 113x120 and non-square. A
      // declared icon that doesn't match its real dimensions can silently fail
      // Chrome's installability check (no error shown, the install prompt/
      // "Install App" option just never appears), which is almost certainly
      // why the app wasn't installable as a desktop PWA.
      includeAssets: ["favicon.ico", "logo-mark.png", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "Hall Collins Real Estate Group",
        short_name: "Hall Collins",
        description: "Transaction dashboard for Hall Collins Real Estate Group",
        theme_color: "#173348",
        background_color: "#F7F5F0",
        display: "standalone",
        start_url: "/",
        // "any" only, deliberately — a maskable icon is expected to keep its
        // content inside a ~80% safe zone since the OS crops it into various
        // mask shapes, which would clip our logo now that it fills ~94% of
        // the canvas. "any" is rendered as-is, no cropping risk, and is the
        // one that actually matters for a desktop install.
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
});
