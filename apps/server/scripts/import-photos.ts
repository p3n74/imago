/**
 * Photo import script: walks PHOTOS_IMPORT_PATH, generates WebP previews, and inserts into DB.
 * Run: bun run apps/server/scripts/import-photos.ts (from project root)
 * Or: bun run scripts/import-photos.ts (from apps/server)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from apps/server before importing env/db
dotenv.config({ path: path.join(__dirname, "../.env") });

const { env } = await import("@template/env/server");
const { prisma } = await import("@template/db");

// Resolve paths: .env is in apps/server, storage is at project root
const SERVER_DIR = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(SERVER_DIR, "../..");
const PREVIEWS_BASE = path.join(PROJECT_ROOT, "storage", "photos", "previews");

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
]);

const PREVIEW_MAX_SIZE = 1200;
const PREVIEW_QUALITY = 80;

async function* walkDir(dir: string, baseDir: string): AsyncGenerator<string> {
  let entries: { name: string }[];
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
      if (IMAGE_EXTENSIONS.has(ext)) {
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
    existingPhotos.map((photo) => [photo.relativePath, photo.id])
  );

  let created = 0;
  let updated = 0;
  let skippedExisting = 0;
  let errors = 0;

  for await (const relativePath of walkDir(importPath, importPath)) {
    const sourcePath = path.join(importPath, relativePath);
    const filename = path.basename(relativePath);
    const previewPath = path.join(
      PREVIEWS_BASE,
      relativePath.replace(/\.[^.]+$/, ".webp")
    );

    try {
      const existingId = existingPhotoByRelativePath.get(relativePath);
      // Fast path: if a photo record already exists and preview file already exists,
      // skip all expensive work (stat + sharp + db write).
      if (existingId && existsSync(previewPath)) {
        skippedExisting++;
        if (skippedExisting % 200 === 0) {
          console.log(`Skipped ${skippedExisting} existing photos...`);
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
        updated++;
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
        created++;
      }

      if ((created + updated + skippedExisting) % 50 === 0) {
        console.log(`Processed ${created + updated + skippedExisting} photos...`);
      }
    } catch (err) {
      console.error(`Error processing ${relativePath}:`, err);
      errors++;
    }
  }

  console.log(
    `\nDone. Imported: ${created}, Updated: ${updated}, Skipped existing: ${skippedExisting}, Errors: ${errors}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
