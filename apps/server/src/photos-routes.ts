import type { Request, Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { auth } from "@template/auth";
import { prisma } from "@template/db";
import { env } from "@template/env/server";
import { fromNodeHeaders } from "better-auth/node";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Server src is at apps/server/src, so ../../.. = project root (src -> server -> apps -> root)
const _serverRoot = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(_serverRoot, "../..");

const PREVIEWS_BASE = path.join(PROJECT_ROOT, "storage", "photos", "previews");

async function requireWhitelistedUser(req: Request): Promise<{ email: string } | null> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session?.user?.email) return null;

  const authorized = await prisma.authorizedUser.findUnique({
    where: { email: session.user.email },
  });

  return authorized ? { email: session.user.email } : null;
}

function getPreviewPath(relativePath: string): string {
  const base = relativePath.replace(/\.[^.]+$/, "");
  return path.join(PREVIEWS_BASE, `${base}.webp`);
}

function getOriginalPath(relativePath: string): string {
  const importPath = path.resolve(PROJECT_ROOT, env.PHOTOS_IMPORT_PATH);
  return path.join(importPath, relativePath);
}

export async function handlePreview(req: Request, res: Response): Promise<void> {
  const user = await requireWhitelistedUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "Missing photo id" });
    return;
  }

  const photo = await prisma.photo.findUnique({ where: { id } });
  if (!photo) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }

  const filePath = getPreviewPath(photo.relativePath);
  if (!existsSync(filePath)) {
    res.status(404).json({ error: "Preview not found" });
    return;
  }

  const stats = await stat(filePath);
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Content-Length", stats.size);
  res.setHeader("Cache-Control", "public, max-age=86400");

  const stream = createReadStream(filePath);
  stream.pipe(res);
}

export async function handleDownload(req: Request, res: Response): Promise<void> {
  const user = await requireWhitelistedUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "Missing photo id" });
    return;
  }

  const photo = await prisma.photo.findUnique({ where: { id } });
  if (!photo) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }

  const filePath = getOriginalPath(photo.relativePath);
  if (!existsSync(filePath)) {
    res.status(404).json({ error: "Original file not found" });
    return;
  }

  const stats = await stat(filePath);
  res.setHeader("Content-Type", photo.mimeType);
  res.setHeader("Content-Length", stats.size);
  res.setHeader("Content-Disposition", `attachment; filename="${photo.filename}"`);

  const stream = createReadStream(filePath);
  stream.pipe(res);
}
