import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), tanstackRouter({}), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3001,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        secure: false,
        cookieDomainRewrite: { "*": "localhost" },
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (req.headers.cookie) {
              proxyReq.setHeader("cookie", req.headers.cookie);
            }
          });
          proxy.on("proxyRes", (proxyRes) => {
            const cookies = proxyRes.headers["set-cookie"];
            if (cookies) {
              proxyRes.headers["set-cookie"] = cookies.map((cookie: string) =>
                cookie
                  .replace(/;\s*Secure/gi, "")
                  .replace(/domain=[^;]+/gi, "domain=localhost")
              );
            }
          });
        },
      },
      "/trpc": {
        target: "http://localhost:3000",
        changeOrigin: true,
        secure: false,
        cookieDomainRewrite: { "*": "localhost" },
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (req.headers.cookie) {
              proxyReq.setHeader("cookie", req.headers.cookie);
            }
          });
          proxy.on("proxyRes", (proxyRes) => {
            const cookies = proxyRes.headers["set-cookie"];
            if (cookies) {
              proxyRes.headers["set-cookie"] = cookies.map((cookie: string) =>
                cookie
                  .replace(/;\s*Secure/gi, "")
                  .replace(/domain=[^;]+/gi, "domain=localhost")
              );
            }
          });
        },
      },
    },
  },
});
