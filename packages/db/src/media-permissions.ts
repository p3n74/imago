import type { PrismaClientType } from "./index";

type FolderRecord = { folder: string };

export type MediaPermissionContext = {
  deniedByDefaultFolders: Set<string>;
  explicitlyAllowedFolders: Set<string>;
};

function normalizeFolderValue(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").trim();
}

export function extractTopFolder(pathValue?: string | null): string | null {
  if (!pathValue) return null;
  const normalized = normalizeFolderValue(pathValue);
  if (!normalized) return null;
  const [topFolder] = normalized.split("/");
  return topFolder?.trim() ? topFolder.trim() : null;
}

export function resolveTopFolderFromMedia(input: {
  album?: string | null;
  relativePath?: string | null;
}): string | null {
  return extractTopFolder(input.album) ?? extractTopFolder(input.relativePath);
}

export function canAccessTopFolder(
  topFolder: string | null,
  context: MediaPermissionContext,
): boolean {
  // Items without a folder segment stay visible under global allow-by-default behavior.
  if (!topFolder) return true;
  if (context.explicitlyAllowedFolders.has(topFolder)) return true;
  if (context.deniedByDefaultFolders.has(topFolder)) return false;
  return true;
}

export function filterAccessibleValues<T>(
  items: T[],
  getTopFolder: (item: T) => string | null,
  context: MediaPermissionContext,
): T[] {
  return items.filter((item) => canAccessTopFolder(getTopFolder(item), context));
}

export async function loadMediaPermissionContext(
  prisma: PrismaClientType,
  email: string,
): Promise<MediaPermissionContext> {
  const [policies, allows] = await Promise.all([
    prisma.folderPolicy.findMany({
      where: { defaultDeny: true },
      select: { folder: true },
    }),
    prisma.folderPermission.findMany({
      where: { email, allow: true },
      select: { folder: true },
    }),
  ]);

  return {
    deniedByDefaultFolders: new Set(
      policies.map((record: FolderRecord) => extractTopFolder(record.folder)).filter(Boolean) as string[],
    ),
    explicitlyAllowedFolders: new Set(
      allows.map((record: FolderRecord) => extractTopFolder(record.folder)).filter(Boolean) as string[],
    ),
  };
}
