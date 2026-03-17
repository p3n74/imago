import type { Request, Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, stat, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { auth } from "@template/auth";
import { prisma } from "@template/db";
import {
  canAccessTopFolder,
  loadMediaPermissionContext,
  resolveTopFolderFromMedia,
} from "@template/db/media-permissions";
import { env } from "@template/env/server";
import { fromNodeHeaders } from "better-auth/node";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _serverRoot = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(_serverRoot, "../..");

const METRIC_TRAFFIC_TOTAL_BYTES = "traffic_total_bytes";
const DEFAULT_VIDEO_CACHE_PATH = path.join(PROJECT_ROOT, "storage", "videos", "tmp");
const VIDEO_CACHE_BASE = env.VIDEO_CACHE_PATH
  ? path.resolve(PROJECT_ROOT, env.VIDEO_CACHE_PATH)
  : DEFAULT_VIDEO_CACHE_PATH;
const VIDEO_CACHE_MAX_AGE_DAYS = Math.max(1, env.VIDEO_CACHE_MAX_AGE_DAYS);
const VIDEO_CACHE_MAX_SIZE_BYTES = Math.max(1, env.VIDEO_CACHE_MAX_SIZE_GB) * 1024 * 1024 * 1024;
const VIDEO_MAX_CONCURRENT_TRANSCODES = Math.max(1, env.VIDEO_MAX_CONCURRENT_TRANSCODES);
const VIDEO_PERF_LOGS = env.VIDEO_PERF_LOGS;

const activeTranscodes = new Map<string, Promise<void>>();
let cleanupStarted = false;
let warnedMissingFfmpeg = false;
let activeTranscodeCount = 0;
const transcodeWaiters: Array<() => void> = [];

type StreamProfile = "low" | "med" | "high";
const STREAM_PROFILES: Record<
  StreamProfile,
  { maxWidth: number; crf: number; videoBitrate: string; audioBitrate: string }
> = {
  low: { maxWidth: 640, crf: 31, videoBitrate: "900k", audioBitrate: "96k" },
  med: { maxWidth: 960, crf: 29, videoBitrate: "1700k", audioBitrate: "112k" },
  high: { maxWidth: 1280, crf: 26, videoBitrate: "3000k", audioBitrate: "128k" },
};

function getProfile(queryValue: unknown): StreamProfile {
  if (typeof queryValue !== "string") return "low";
  if (queryValue === "low" || queryValue === "med" || queryValue === "high") return queryValue;
  return "low";
}

function perfLog(message: string, extra?: Record<string, unknown>): void {
  if (!VIDEO_PERF_LOGS) return;
  if (extra) {
    console.info(`[video-perf] ${message}`, extra);
    return;
  }
  console.info(`[video-perf] ${message}`);
}

async function incrementTrafficMetric(bytesSent: number, kind: string): Promise<void> {
  if (!Number.isFinite(bytesSent) || bytesSent <= 0) return;

  const bytes = BigInt(bytesSent);
  await Promise.all([
    prisma.appMetric.upsert({
      where: { key: METRIC_TRAFFIC_TOTAL_BYTES },
      create: {
        key: METRIC_TRAFFIC_TOTAL_BYTES,
        value: bytes,
      },
      update: {
        value: {
          increment: bytes,
        },
      },
    }),
    prisma.trafficMetricEvent.create({
      data: {
        bytes,
        kind,
      },
    }),
  ]);
}

async function requireWhitelistedUser(
  req: Request,
): Promise<{ email: string; role: string } | null> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session?.user?.email) return null;

  const authorized = await prisma.authorizedUser.findUnique({
    where: { email: session.user.email },
  });

  return authorized ? { email: session.user.email, role: authorized.role } : null;
}

function getOriginalVideoPath(relativePath: string): string {
  const importPath = path.resolve(PROJECT_ROOT, env.PHOTOS_IMPORT_PATH);
  return path.join(importPath, relativePath);
}

function getCachedTranscodePath(videoId: string, profile: StreamProfile): string {
  return path.join(VIDEO_CACHE_BASE, `${videoId}-${profile}.mp4`);
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function transcodeVideoToCache(
  inputPath: string,
  cachePath: string,
  profile: StreamProfile,
): Promise<void> {
  await ensureDir(path.dirname(cachePath));
  const config = STREAM_PROFILES[profile];
  const scaleFilter = `scale='min(${config.maxWidth},iw)':-2`;
  const startedAt = Date.now();

  await new Promise<void>((resolve, reject) => {
    let ffmpeg: ReturnType<typeof spawn>;
    try {
      ffmpeg = spawn(
        "ffmpeg",
        [
          "-y",
          "-i",
          inputPath,
          "-vf",
          scaleFilter,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          String(config.crf),
          "-maxrate",
          config.videoBitrate,
          "-bufsize",
          config.videoBitrate,
          "-c:a",
          "aac",
          "-b:a",
          config.audioBitrate,
          "-movflags",
          "+faststart",
          cachePath,
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
    } catch (err) {
      reject(err);
      return;
    }

    let stderr = "";
    ffmpeg.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    ffmpeg.on("error", (err) => {
      reject(err);
    });
    ffmpeg.on("close", (code) => {
      const elapsedMs = Date.now() - startedAt;
      if (code === 0) {
        perfLog("transcode complete", { profile, cachePath, elapsedMs });
        resolve();
      } else {
        perfLog("transcode failed", { profile, cachePath, elapsedMs, code });
        reject(new Error(`ffmpeg failed with code ${code}: ${stderr}`));
      }
    });
  });
}

async function acquireTranscodeSlot(): Promise<void> {
  if (activeTranscodeCount < VIDEO_MAX_CONCURRENT_TRANSCODES) {
    activeTranscodeCount += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    transcodeWaiters.push(() => {
      activeTranscodeCount += 1;
      resolve();
    });
  });
}

function releaseTranscodeSlot(): void {
  activeTranscodeCount = Math.max(0, activeTranscodeCount - 1);
  const next = transcodeWaiters.shift();
  if (next) next();
}

async function ensureCachedVideo(
  videoId: string,
  sourcePath: string,
  profile: StreamProfile,
): Promise<{ cachePath: string; cacheHit: boolean }> {
  const cachePath = getCachedTranscodePath(videoId, profile);
  if (existsSync(cachePath)) return { cachePath, cacheHit: true };

  const lockKey = `${videoId}:${profile}`;
  const existingPromise = activeTranscodes.get(lockKey);
  if (existingPromise) {
    await existingPromise;
    return { cachePath, cacheHit: false };
  }

  const transcodePromise = (async () => {
    await acquireTranscodeSlot();
    try {
      await transcodeVideoToCache(sourcePath, cachePath, profile);
    } finally {
      releaseTranscodeSlot();
      activeTranscodes.delete(lockKey);
    }
  })();
  activeTranscodes.set(lockKey, transcodePromise);
  await transcodePromise;
  return { cachePath, cacheHit: false };
}

async function sendFileWithRange(
  req: Request,
  res: Response,
  filePath: string,
  mimeType: string,
  inlineFilename?: string,
): Promise<number> {
  const stats = await stat(filePath);
  const fileSize = stats.size;
  const range = req.headers.range;

  if (!range) {
    res.status(200);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", fileSize);
    if (inlineFilename) {
      res.setHeader("Content-Disposition", `inline; filename="${inlineFilename}"`);
    }
    createReadStream(filePath).pipe(res);
    return fileSize;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end();
    return 0;
  }

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : fileSize - 1;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end >= fileSize ||
    start > end
  ) {
    res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end();
    return 0;
  }

  const chunkSize = end - start + 1;
  res.status(206);
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
  res.setHeader("Content-Length", chunkSize);
  if (inlineFilename) {
    res.setHeader("Content-Disposition", `inline; filename="${inlineFilename}"`);
  }
  createReadStream(filePath, { start, end }).pipe(res);
  return chunkSize;
}

async function cleanupOldCachedVideos(): Promise<void> {
  try {
    if (!existsSync(VIDEO_CACHE_BASE)) return;
    const entries = await readdir(VIDEO_CACHE_BASE, { withFileTypes: true });
    const cutoff = Date.now() - VIDEO_CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    const filesByOldest: Array<{ fullPath: string; mtimeMs: number; size: number }> = [];
    let totalSizeBytes = 0;

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fullPath = path.join(VIDEO_CACHE_BASE, entry.name);
      try {
        const fileStats = await stat(fullPath);
        totalSizeBytes += fileStats.size;
        filesByOldest.push({
          fullPath,
          mtimeMs: fileStats.mtimeMs,
          size: fileStats.size,
        });
        if (fileStats.mtimeMs < cutoff) {
          await rm(fullPath, { force: true });
          totalSizeBytes -= fileStats.size;
        }
      } catch {
        // best-effort cleanup
      }
    }

    if (totalSizeBytes > VIDEO_CACHE_MAX_SIZE_BYTES) {
      filesByOldest.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const file of filesByOldest) {
        if (totalSizeBytes <= VIDEO_CACHE_MAX_SIZE_BYTES) break;
        try {
          await rm(file.fullPath, { force: true });
          totalSizeBytes -= file.size;
        } catch {
          // best-effort cleanup
        }
      }
      perfLog("cache trimmed by size guard", {
        maxBytes: VIDEO_CACHE_MAX_SIZE_BYTES,
        remainingBytes: totalSizeBytes,
      });
    }
  } catch (err) {
    console.warn("Failed to clean up old cached videos:", err);
  }
}

export function startVideoCacheCleanupJob(): void {
  if (cleanupStarted) return;
  cleanupStarted = true;

  void cleanupOldCachedVideos();
  const intervalMs = 6 * 60 * 60 * 1000; // every 6 hours
  setInterval(() => {
    void cleanupOldCachedVideos();
  }, intervalMs).unref();
}

export async function handleVideoStream(req: Request, res: Response): Promise<void> {
  const requestStartedAt = Date.now();
  const user = await requireWhitelistedUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "Missing video id" });
    return;
  }

  const video = await prisma.video.findUnique({ where: { id } });
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  if (user.role !== "ADMIN") {
    const permissionContext = await loadMediaPermissionContext(prisma, user.email);
    const topFolder = resolveTopFolderFromMedia({
      album: video.album,
      relativePath: video.relativePath,
    });
    if (!canAccessTopFolder(topFolder, permissionContext)) {
      res.status(404).json({ error: "Video not found" });
      return;
    }
  }

  const sourcePath = getOriginalVideoPath(video.relativePath);
  if (!existsSync(sourcePath)) {
    res.status(404).json({ error: "Original video file not found" });
    return;
  }

  const profile = getProfile(req.query.quality);
  try {
    const { cachePath: cachedPath, cacheHit } = await ensureCachedVideo(video.id, sourcePath, profile);
    if (!existsSync(cachedPath)) {
      res.status(500).json({ error: "Transcoded stream is unavailable" });
      return;
    }

    const bytesSent = await sendFileWithRange(
      req,
      res,
      cachedPath,
      "video/mp4",
      `${video.filename}.mp4`,
    );
    await incrementTrafficMetric(bytesSent, "video_stream");
    perfLog("stream served", {
      videoId: video.id,
      profile,
      cacheHit,
      bytesSent,
      totalMs: Date.now() - requestStartedAt,
      range: req.headers.range ?? null,
    });
  } catch (err) {
    // Local dev fallback when ffmpeg is unavailable: stream original video directly.
    const isSpawnMissing =
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      String((err as { code: unknown }).code) === "ENOENT";
    if (isSpawnMissing) {
      if (!warnedMissingFfmpeg) {
        warnedMissingFfmpeg = true;
        console.warn(
          "ffmpeg not found in PATH. Falling back to original video streaming without compression.",
        );
      }
      const bytesSent = await sendFileWithRange(
        req,
        res,
        sourcePath,
        video.mimeType,
        video.filename,
      );
      await incrementTrafficMetric(bytesSent, "video_stream_original");
      perfLog("stream fallback original", {
        videoId: video.id,
        bytesSent,
        totalMs: Date.now() - requestStartedAt,
      });
      return;
    }
    throw err;
  }
}

export async function handleVideoDownload(req: Request, res: Response): Promise<void> {
  const user = await requireWhitelistedUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "Missing video id" });
    return;
  }

  const video = await prisma.video.findUnique({ where: { id } });
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  if (user.role !== "ADMIN") {
    const permissionContext = await loadMediaPermissionContext(prisma, user.email);
    const topFolder = resolveTopFolderFromMedia({
      album: video.album,
      relativePath: video.relativePath,
    });
    if (!canAccessTopFolder(topFolder, permissionContext)) {
      res.status(404).json({ error: "Video not found" });
      return;
    }
  }

  const sourcePath = getOriginalVideoPath(video.relativePath);
  if (!existsSync(sourcePath)) {
    res.status(404).json({ error: "Original video file not found" });
    return;
  }

  const stats = await stat(sourcePath);
  res.setHeader("Content-Type", video.mimeType);
  res.setHeader("Content-Length", stats.size);
  res.setHeader("Content-Disposition", `attachment; filename="${video.filename}"`);
  createReadStream(sourcePath).pipe(res);
  await incrementTrafficMetric(stats.size, "video_download");
}
