import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  canAccessTopFolder,
  extractTopFolder,
  loadMediaPermissionContext,
  resolveTopFolderFromMedia,
} from "@template/db/media-permissions";
import { whitelistedProcedure, router } from "../index";

function getBlockedTopFolders(
  deniedByDefaultFolders: Set<string>,
  explicitlyAllowedFolders: Set<string>,
): string[] {
  return Array.from(deniedByDefaultFolders).filter((folder) => !explicitlyAllowedFolders.has(folder));
}

function buildBlockedFolderWhere(blockedTopFolders: string[]) {
  if (blockedTopFolders.length === 0) return undefined;
  return {
    NOT: blockedTopFolders.map((folder) => ({
      relativePath: { startsWith: `${folder}/` },
    })),
  } as const;
}

async function getBlockedTopFoldersForUser(ctx: {
  userRole: string | null;
  prisma: Parameters<typeof loadMediaPermissionContext>[0];
  session: { user: { email: string } };
}): Promise<string[]> {
  if (ctx.userRole === "ADMIN") return [];
  const permissionContext = await loadMediaPermissionContext(ctx.prisma, ctx.session.user.email);
  return getBlockedTopFolders(
    permissionContext.deniedByDefaultFolders,
    permissionContext.explicitlyAllowedFolders,
  );
}

export const videosRouter = router({
  listPage: whitelistedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).optional().default(24),
        page: z.number().int().min(1).optional().default(1),
        album: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const blockedTopFolders = await getBlockedTopFoldersForUser(ctx);
      const limit = input.limit;
      const page = input.page;
      const album = input.album;
      const requestedTopFolder = extractTopFolder(album);

      if (requestedTopFolder && blockedTopFolders.includes(requestedTopFolder)) {
        return {
          items: [],
          page: 1,
          limit,
          total: 0,
          totalPages: 1,
          hasPrevPage: false,
          hasNextPage: false,
        };
      }

      const blockedWhere = buildBlockedFolderWhere(blockedTopFolders);
      const where = {
        ...(album ? { album } : {}),
        ...(blockedWhere ?? {}),
      };

      const total = await ctx.prisma.video.count({ where });
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const safePage = Math.min(page, totalPages);
      const items = await ctx.prisma.video.findMany({
        where,
        skip: (safePage - 1) * limit,
        take: limit,
        orderBy: [{ takenAt: "desc" }, { createdAt: "desc" }],
      });

      return {
        items,
        page: safePage,
        limit,
        total,
        totalPages,
        hasPrevPage: safePage > 1,
        hasNextPage: safePage < totalPages,
      };
    }),

  getById: whitelistedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const video = await ctx.prisma.video.findUnique({
        where: { id: input.id },
      });

      if (!video) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Video not found",
        });
      }

      if (ctx.userRole !== "ADMIN") {
        const permissionContext = await loadMediaPermissionContext(ctx.prisma, ctx.session.user.email);
        const topFolder = resolveTopFolderFromMedia({
          album: video.album,
          relativePath: video.relativePath,
        });
        if (!canAccessTopFolder(topFolder, permissionContext)) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Video not found",
          });
        }
      }

      return video;
    }),

  getAlbums: whitelistedProcedure.query(async ({ ctx }) => {
    const blockedTopFolders = await getBlockedTopFoldersForUser(ctx);
    const blockedWhere = buildBlockedFolderWhere(blockedTopFolders);
    const albums = await ctx.prisma.video.findMany({
      select: { album: true },
      distinct: ["album"],
      where: {
        album: { not: null },
        ...(blockedWhere ?? {}),
      },
      orderBy: { album: "asc" },
    });

    return albums.map((a) => a.album).filter((a): a is string => !!a);
  }),
});
