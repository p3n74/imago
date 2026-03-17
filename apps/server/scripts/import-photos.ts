/**
 * Photo import script: walks PHOTOS_IMPORT_PATH, generates WebP previews, and inserts into DB.
 * Run: bun run apps/server/scripts/import-photos.ts (from project root)
 * Or: bun run scripts/import-photos.ts (from apps/server)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import dotenv from "dotenv";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from apps/server before importing env/db
dotenv.config({ path: path.join(__dirname, "../.env") });

const { env } = await import("@template/env/server");
const dbModule = await import("@template/db");
const prisma: any = dbModule.prisma;

// Resolve paths: .env is in apps/server, storage is at project root
const SERVER_DIR = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(SERVER_DIR, "../..");
const PREVIEWS_BASE = path.join(PROJECT_ROOT, "storage", "photos", "previews");

const IMAGE_EXTENSIONS = new Set<string>([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
]);
const VIDEO_EXTENSIONS = new Set<string>([
  ".mp4",
  ".mov",
  ".mkv",
  ".avi",
  ".m4v",
  ".wmv",
  ".webm",
]);

const PREVIEW_MAX_SIZE = 1200;
const PREVIEW_QUALITY = 80;

async function* walkDir(dir: string, baseDir: string): AsyncGenerator<string> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`Cannot read directory ${dir}:`, err);
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      yield* walkDir(fullPath, baseDir);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      // Skip AppleDouble metadata files (e.g. "._IMG_001.jpg")
      if (entry.name.startsWith("._")) continue;

      if (IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext)) {
        yield relativePath.replace(/\\/g, "/");
      }
    }
  }
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function generatePreview(
  sourcePath: string,
  destPath: string
): Promise<{ width: number; height: number } | null> {
  await ensureDir(path.dirname(destPath));

  try {
    let pipeline = sharp(sourcePath);
    const metadata = await pipeline.metadata();
    const w = metadata.width ?? 0;
    const h = metadata.height ?? 0;

    if (w <= PREVIEW_MAX_SIZE && h <= PREVIEW_MAX_SIZE) {
      await pipeline.webp({ quality: PREVIEW_QUALITY }).toFile(destPath);
      return { width: w, height: h };
    }

    const scale = Math.min(PREVIEW_MAX_SIZE / w, PREVIEW_MAX_SIZE / h);
    const newW = Math.round(w * scale);
    const newH = Math.round(h * scale);

    await pipeline
      .resize(newW, newH)
      .webp({ quality: PREVIEW_QUALITY })
      .toFile(destPath);

    return { width: newW, height: newH };
  } catch (err) {
    console.error(`Failed to generate preview for ${sourcePath}:`, err);
    return null;
  }
}

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mime: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".m4v": "video/x-m4v",
    ".wmv": "video/x-ms-wmv",
    ".webm": "video/webm",
  };
  return mime[ext] ?? "application/octet-stream";
}

function getAlbum(relativePath: string): string {
  // Use the full folder path (without the filename) as the album,
  // so albums mirror the actual directory structure (e.g. "2005/1) early pics ...").
  const segments = relativePath.split("/");
  if (segments.length <= 1) return "default";
  const folderPath = segments.slice(0, -1).join("/");
  return folderPath || "default";
}

type VideoMetadata = {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
};

let warnedMissingFfprobe = false;

function parseNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function getVideoMetadata(sourcePath: string): Promise<VideoMetadata> {
  return new Promise((resolve) => {
    const args = [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      sourcePath,
    ];
    let ffprobe: ReturnType<typeof spawn>;
    try {
      ffprobe = spawn("ffprobe", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      if (!warnedMissingFfprobe) {
        warnedMissingFfprobe = true;
        console.warn(
          "ffprobe not found in PATH. Video metadata will be imported as unknown (duration/resolution null).",
        );
      }
      resolve({ durationSeconds: null, width: null, height: null });
      return;
    }

    let stdout = "";
    let stderr = "";
    ffprobe.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    ffprobe.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    ffprobe.on("error", (err) => {
      if (!warnedMissingFfprobe) {
        warnedMissingFfprobe = true;
        console.warn(
          `ffprobe failed to start (${String(err)}). Video metadata will be imported as unknown.`,
        );
      }
      resolve({ durationSeconds: null, width: null, height: null });
    });

    ffprobe.on("close", (code) => {
      if (code !== 0) {
        console.warn(`ffprobe failed for ${sourcePath}: ${stderr.trim() || `exit code ${code}`}`);
        resolve({ durationSeconds: null, width: null, height: null });
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as {
          streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
          format?: { duration?: string | number };
        };
        const videoStream =
          parsed.streams?.find((stream) => stream.codec_type === "video") ?? null;

        resolve({
          durationSeconds: parseNullableNumber(parsed.format?.duration ?? null),
          width: parseNullableNumber(videoStream?.width ?? null),
          height: parseNullableNumber(videoStream?.height ?? null),
        });
      } catch (err) {
        console.warn(`Failed to parse ffprobe output for ${sourcePath}:`, err);
        resolve({ durationSeconds: null, width: null, height: null });
      }
    });
  });
}

async function main() {
  const importPath = path.resolve(PROJECT_ROOT, env.PHOTOS_IMPORT_PATH);

  if (!existsSync(importPath)) {
    console.error(
      `Import path does not exist: ${importPath}\nSet PHOTOS_IMPORT_PATH in .env (e.g. ./import/photos or /data/photos)`
    );
    process.exit(1);
  }

  console.log(`Importing photos from: ${importPath}`);
  console.log(`Previews will be saved to: ${PREVIEWS_BASE}`);

  // Build an in-memory lookup once so reruns are fast.
  // This avoids one DB query per file during large imports.
  const existingPhotos = await prisma.photo.findMany({
    select: {
      id: true,
      relativePath: true,
    },
  });
  const existingPhotoByRelativePath = new Map(
    existingPhotos.map((photo: { id: string; relativePath: string }) => [photo.relativePath, photo.id])
  );
  const existingVideos = await prisma.video.findMany({
    select: {
      id: true,
      relativePath: true,
    },
  });
  const existingVideoByRelativePath = new Map(
    existingVideos.map((video: { id: string; relativePath: string }) => [video.relativePath, video.id])
  );

  let photosCreated = 0;
  let photosUpdated = 0;
  let photosSkippedExisting = 0;
  let videosCreated = 0;
  let videosSkippedExisting = 0;
  let errors = 0;

  for await (const relativePath of walkDir(importPath, importPath)) {
    const sourcePath = path.join(importPath, relativePath);
    const filename = path.basename(relativePath);
    const ext = path.extname(filename).toLowerCase();
    const previewPath = path.join(
      PREVIEWS_BASE,
      relativePath.replace(/\.[^.]+$/, ".webp")
    );

    try {
      if (IMAGE_EXTENSIONS.has(ext)) {
        const existingId = existingPhotoByRelativePath.get(relativePath);
        // Fast path: if a photo record already exists and preview file already exists,
        // skip all expensive work (stat + sharp + db write).
        if (existingId && existsSync(previewPath)) {
          photosSkippedExisting++;
          if (photosSkippedExisting % 200 === 0) {
            console.log(`Skipped ${photosSkippedExisting} existing photos...`);
          }
          continue;
        }

        const statResult = await stat(sourcePath);
        const fileSize = statResult.size;

        const dimensions = await generatePreview(sourcePath, previewPath);
        if (!dimensions) {
          errors++;
          continue;
        }

        const album = getAlbum(relativePath);
        const mimeType = getMimeType(filename);

        if (existingId) {
          await prisma.photo.update({
            where: { id: existingId },
            data: {
              album,
              mimeType,
              width: dimensions.width,
              height: dimensions.height,
              fileSize,
            },
          });
          photosUpdated++;
        } else {
          const createdPhoto = await prisma.photo.create({
            data: {
              filename,
              relativePath,
              album,
              mimeType,
              width: dimensions.width,
              height: dimensions.height,
              fileSize,
            },
          });
          existingPhotoByRelativePath.set(relativePath, createdPhoto.id);
          photosCreated++;
        }
      } else if (VIDEO_EXTENSIONS.has(ext)) {
        const existingVideoId = existingVideoByRelativePath.get(relativePath);
        if (existingVideoId) {
          videosSkippedExisting++;
          if (videosSkippedExisting % 200 === 0) {
            console.log(`Skipped ${videosSkippedExisting} existing videos...`);
          }
          continue;
        }

        const statResult = await stat(sourcePath);
        const fileSize = statResult.size;
        const album = getAlbum(relativePath);
        const mimeType = getMimeType(filename);
        const metadata = await getVideoMetadata(sourcePath);
        const createdVideo = await prisma.video.create({
          data: {
            filename,
            relativePath,
            album,
            mimeType,
            durationSeconds: metadata.durationSeconds,
            width: metadata.width,
            height: metadata.height,
            fileSize,
          },
        });
        existingVideoByRelativePath.set(relativePath, createdVideo.id);
        videosCreated++;
      }

      const processedTotal =
        photosCreated +
        photosUpdated +
        photosSkippedExisting +
        videosCreated +
        videosSkippedExisting;
      if (processedTotal % 50 === 0) {
        console.log(`Processed ${processedTotal} media files...`);
      }
    } catch (err) {
      console.error(`Error processing ${relativePath}:`, err);
      errors++;
    }
  }

  console.log(
    `\nDone.
Photos -> Imported: ${photosCreated}, Updated: ${photosUpdated}, Skipped existing: ${photosSkippedExisting}
Videos -> Imported: ${videosCreated}, Skipped existing: ${videosSkippedExisting}
Errors: ${errors}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
