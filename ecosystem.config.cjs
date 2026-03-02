/**
 * PM2 ecosystem file.
 */
/** @type {import('pm2').StartOptions} */
module.exports = {
  apps: [
    {
      name: "imago-server",
      cwd: "./apps/server",
      script: "bun",
      args: "run dist/index.mjs",
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
        BETTER_AUTH_URL: "http://localhost:3000",
        CORS_ORIGIN: "http://localhost:5173",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
    },
  ],
};
