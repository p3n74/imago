import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { whitelistedProcedure, router } from "../index";

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
      const limit = input.limit;
      const page = input.page;
      const album = input.album;
      const where = album ? { album } : undefined;

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

      return video;
    }),

  getAlbums: whitelistedProcedure.query(async ({ ctx }) => {
    const albums = await ctx.prisma.video.findMany({
      select: { album: true },
      distinct: ["album"],
      where: { album: { not: null } },
      orderBy: { album: "asc" },
    });

    return albums.map((a) => a.album).filter((a): a is string => !!a);
  }),
});
