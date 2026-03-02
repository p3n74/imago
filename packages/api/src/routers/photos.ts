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

  getAnalytics: whitelistedProcedure.query(async ({ ctx }) => {
    const [photoCount, photoSizeAgg, totalTrafficMetric] = await Promise.all([
      ctx.prisma.photo.count(),
      ctx.prisma.photo.aggregate({
        _sum: {
          fileSize: true,
        },
      }),
      ctx.prisma.appMetric.findUnique({
        where: { key: "traffic_total_bytes" },
      }),
    ]);

    return {
      photoCount,
      totalStorageBytes: photoSizeAgg._sum.fileSize ?? 0,
      totalTrafficBytes: totalTrafficMetric?.value.toString() ?? "0",
    };
  }),

  getAnalyticsSeries: whitelistedProcedure
    .input(
      z
        .object({
          days: z.number().int().min(7).max(365).optional().default(30),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 30;

      const utcToday = new Date();
      const end = new Date(
        Date.UTC(
          utcToday.getUTCFullYear(),
          utcToday.getUTCMonth(),
          utcToday.getUTCDate(),
        ),
      );
      const start = new Date(end.getTime());
      start.setUTCDate(start.getUTCDate() - (days - 1));
      const endExclusive = new Date(end.getTime());
      endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

      const [photosBeforeStart, photosInRange, trafficInRange] = await Promise.all([
        ctx.prisma.photo.count({
          where: { createdAt: { lt: start } },
        }),
        ctx.prisma.photo.findMany({
          where: {
            createdAt: { gte: start, lt: endExclusive },
          },
          select: { createdAt: true },
        }),
        ctx.prisma.trafficMetricEvent.findMany({
          where: {
            createdAt: { gte: start, lt: endExclusive },
          },
          select: { createdAt: true, bytes: true },
        }),
      ]);

      const photosAddedByDay = new Map<string, number>();
      for (const photo of photosInRange) {
        const key = photo.createdAt.toISOString().slice(0, 10);
        photosAddedByDay.set(key, (photosAddedByDay.get(key) ?? 0) + 1);
      }

      const trafficBytesByDay = new Map<string, bigint>();
      for (const event of trafficInRange) {
        const key = event.createdAt.toISOString().slice(0, 10);
        trafficBytesByDay.set(
          key,
          (trafficBytesByDay.get(key) ?? BigInt(0)) + (event.bytes ?? BigInt(0)),
        );
      }

      let runningPhotosTotal = photosBeforeStart;
      const points: Array<{
        date: string;
        photosAdded: number;
        photosTotal: number;
        trafficBytes: string;
      }> = [];

      for (let i = 0; i < days; i++) {
        const day = new Date(start.getTime());
        day.setUTCDate(start.getUTCDate() + i);
        const key = day.toISOString().slice(0, 10);

        const photosAdded = photosAddedByDay.get(key) ?? 0;
        runningPhotosTotal += photosAdded;
        const trafficBytes = trafficBytesByDay.get(key) ?? BigInt(0);

        points.push({
          date: key,
          photosAdded,
          photosTotal: runningPhotosTotal,
          trafficBytes: trafficBytes.toString(),
        });
      }

      return {
        days,
        points,
      };
    }),
});
