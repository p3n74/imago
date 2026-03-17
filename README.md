# Imago

A private photo gallery with compressed previews and full-resolution download. Self-hosted with Better Auth and team management. Built with React, tRPC, Prisma, and PostgreSQL.

## Tech Stack

- **Framework**: [React](https://reactjs.org/) (Web) & [Expo](https://expo.dev/) (Native)
- **Monorepo**: [Turborepo](https://turbo.build/)
- **API**: [tRPC](https://trpc.io/) for end-to-end type safety
- **Database**: [Prisma](https://www.prisma.io/) with PostgreSQL
- **Auth**: [Better-Auth](https://better-auth.com/)
- **Router**: [TanStack Router](https://tanstack.com/router)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) & [shadcn/ui](https://ui.shadcn.com/)
- **Runtime**: [Bun](https://bun.sh/)

## Project Structure

```
├── apps/
│   ├── web/        # React + Vite web app
│   ├── native/     # Expo mobile app
│   └── server/     # Express backend
├── packages/
│   ├── api/        # tRPC routers
│   ├── auth/       # Better Auth config
│   ├── db/         # Prisma schema & client
│   └── env/        # Type-safe env vars
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/)
- PostgreSQL database
- [FFmpeg](https://ffmpeg.org/) (required for video metadata and on-demand transcoding)

### Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   bun install
   ```
3. Copy env files:
   ```bash
   cp apps/server/.env.example apps/server/.env
   cp apps/web/.env.example apps/web/.env
   ```
4. Apply database schema:
   ```bash
   bun run db:push
   ```
5. Seed admin user:
   ```bash
   bun run seed-admin
   ```

### Development

```bash
bun run dev:imago
```

Starts web (http://localhost:3001) and server (http://localhost:3000).

Other scripts:
- `bun run dev:web` – web only
- `bun run dev:server` – server only
- `bun run dev:native` – mobile app

### Photo Import

1. Copy your photos to `./import/photos` (or set `PHOTOS_IMPORT_PATH` in `.env`).
2. Run the import script:
   ```bash
   bun run photos:import
   ```

### Video Support

- Supported import formats include common containers: MP4, MOV, MKV, AVI, M4V, WMV, WEBM.
- Videos are indexed during `bun run photos:import` using `ffprobe` metadata.
- Streaming endpoint: `/api/videos/stream/:id`
  - Streams a compressed MP4 generated on first request.
  - Uses ephemeral cache at `VIDEO_CACHE_PATH` (default `./storage/videos/tmp`).
- Download endpoint: `/api/videos/download/:id` for original files.
- Cache cleanup:
  - Files older than `VIDEO_CACHE_MAX_AGE_DAYS` are removed periodically by the server.
  - To clear manually, remove files in `VIDEO_CACHE_PATH`.

## Auth & Team

- **Whitelist**: Only users in `AuthorizedUser` can access the app.
- **Roles**: `ADMIN` (manage team) and `USER` (view photos).
- Manage users on the Team page.

### Top-Level Folder Permissions

- Permissions apply to Photos/Videos pages and media file endpoints.
- Controls are top-level folders only (for example, `Family`, `Trips`).
- Global behavior is allow-by-default.
- Admins can mark a top-level folder as deny-by-default:
  - Folder is hidden from everyone unless explicitly allowed per user.
- Admins can grant per-user folder access overrides for deny-by-default folders.
- Direct URL access to preview/download/stream endpoints follows the same folder rules.

After pulling changes, apply schema updates:

```bash
bun run db:push
```

## License

MIT
