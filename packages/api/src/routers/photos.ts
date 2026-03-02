import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { whitelistedProcedure, router } from "../index";

export const photosRouter = router({
  list: whitelistedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(100).optional().default(30),
          cursor: z.string().optional(),
          album: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 30;
      const cursor = input?.cursor;
      const album = input?.album;

      const photos = await ctx.prisma.photo.findMany({
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        where: album ? { album } : undefined,
        orderBy: [{ takenAt: "desc" }, { createdAt: "desc" }],
      });

      const nextCursor = photos.length > limit ? photos[limit - 1]?.id : null;
      const items = photos.slice(0, limit);

      return {
        items,
        nextCursor,
      };
    }),

  listPage: whitelistedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).optional().default(24),
        page: z.number().int().min(1).optional().default(1),
        album: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const limit = input.limit;
      const page = input.page;
      const album = input.album;
      const where = album ? { album } : undefined;

      const total = await ctx.prisma.photo.count({ where });
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const safePage = Math.min(page, totalPages);
      const items = await ctx.prisma.photo.findMany({
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
      const photo = await ctx.prisma.photo.findUnique({
        where: { id: input.id },
      });

      if (!photo) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Photo not found",
        });
      }

      return photo;
    }),

  getAlbums: whitelistedProcedure.query(async ({ ctx }) => {
    const albums = await ctx.prisma.photo.findMany({
      select: { album: true },
      distinct: ["album"],
      where: { album: { not: null } },
      orderBy: { album: "asc" },
    });

    return albums.map((a) => a.album).filter((a): a is string => !!a);
  }),
});
