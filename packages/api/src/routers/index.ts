import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { protectedProcedure, publicProcedure, router, whitelistedProcedure } from "../index";
import { WS_EVENTS, type Context, type WsEmitter } from "../context";
import { teamRouter } from "./team";
import { chatRouter } from "./chat";
import { presenceRouter } from "./presence";
import { photosRouter } from "./photos";

// Helper function to create activity logs and emit WebSocket event
async function logActivity(
  prisma: Context["prisma"],
  userId: string,
  action: string,
  entityType: string,
  description: string,
  entityId?: string,
  metadata?: Record<string, unknown>,
  ws?: WsEmitter | null
) {
  await prisma.activityLog.create({
    data: {
      userId,
      action,
      entityType,
      entityId,
      description,
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
  });

  if (ws) {
    ws.emitToUser(userId, {
      event: WS_EVENTS.ACTIVITY_LOGGED,
      action: "created",
      entityId,
      message: description,
    });
  }
}

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  
  team: teamRouter,
  chat: chatRouter,
  presence: presenceRouter,
  photos: photosRouter,

  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is a protected route",
      user: ctx.session.user,
    };
  }),

  // Activity log
  activityLog: router({
    list: whitelistedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(500).optional().default(50),
          cursor: z.string().optional(),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        const limit = input?.limit ?? 50;
        const cursor = input?.cursor;
        
        const logs = await ctx.prisma.activityLog.findMany({
          take: limit + (cursor ? 1 : 0),
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: {
            user: {
              select: { id: true, name: true, image: true },
            },
          },
        });
        
        const nextCursor = logs.length > limit ? logs[limit - 1].id : null;
        const items = logs.slice(0, limit);
        
        return {
          items: items.map((log) => ({
            id: log.id,
            action: log.action,
            entityType: log.entityType,
            entityId: log.entityId,
            description: log.description,
            metadata: log.metadata ? JSON.parse(log.metadata) : null,
            createdAt: log.createdAt,
            user: log.user,
          })),
          nextCursor,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
