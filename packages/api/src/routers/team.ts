import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicProcedure, router, whitelistedProcedure, adminProcedure } from "../index";

const ROLES = ["ADMIN", "USER"] as const;

export const teamRouter = router({
  // Get current user's role
  getMyRole: protectedProcedure.query(({ ctx }) => {
    return { role: ctx.userRole };
  }),

  // List all authorized users (whitelisted users only)
  list: whitelistedProcedure.query(async ({ ctx }) => {
    const users = await ctx.prisma.authorizedUser.findMany({
      orderBy: { createdAt: "desc" },
    });
    
    // Also fetch their user details if they have registered
    const emails = users.map(u => u.email);
    const registeredUsers = await ctx.prisma.user.findMany({
      where: { email: { in: emails } },
      select: { email: true, name: true, image: true, id: true },
    });

    const registeredMap = new Map(registeredUsers.map(u => [u.email, u]));

    return users.map(u => ({
      ...u,
      registeredUser: registeredMap.get(u.email) || null,
    }));
  }),

  // Add a new authorized user
  add: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        role: z.enum(ROLES),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if already exists
      const existing = await ctx.prisma.authorizedUser.findUnique({
        where: { email: input.email },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User is already authorized",
        });
      }

      const user = await ctx.prisma.authorizedUser.create({
        data: {
          email: input.email,
          role: input.role,
        },
      });

      // Log activity
      await ctx.prisma.activityLog.create({
        data: {
          userId: ctx.session.user.id,
          action: "created",
          entityType: "authorized_user",
          entityId: user.id,
          description: `added ${input.email} as ${input.role}`,
        },
      });

      return user;
    }),

  // Update a user's role
  update: adminProcedure
    .input(
      z.object({
        id: z.string(),
        role: z.enum(ROLES),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.authorizedUser.findUnique({
        where: { id: input.id },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Never allow removing the final ADMIN role.
      if (existing.role === "ADMIN" && input.role !== "ADMIN") {
        const adminCount = await ctx.prisma.authorizedUser.count({
          where: { role: "ADMIN" },
        });
        if (adminCount <= 1) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "At least one administrator is required.",
          });
        }
      }

      const user = await ctx.prisma.authorizedUser.update({
        where: { id: input.id },
        data: { role: input.role },
      });

      // Log activity
      await ctx.prisma.activityLog.create({
        data: {
          userId: ctx.session.user.id,
          action: "updated",
          entityType: "authorized_user",
          entityId: user.id,
          description: `updated ${user.email} role to ${input.role}`,
        },
      });

      return user;
    }),

  // Remove an authorized user
  remove: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.authorizedUser.findUnique({
        where: { id: input.id },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Block admin from removing themselves if they are the last admin
      if (user.role === "ADMIN") {
        const adminCount = await ctx.prisma.authorizedUser.count({
          where: { role: "ADMIN" },
        });
        if (adminCount <= 1) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Cannot remove the last administrator.",
          });
        }
      }

      await ctx.prisma.authorizedUser.delete({
        where: { id: input.id },
      });

      // Log activity
      await ctx.prisma.activityLog.create({
        data: {
          userId: ctx.session.user.id,
          action: "deleted",
          entityType: "authorized_user",
          entityId: input.id,
          description: `removed ${user.email} from authorized users`,
        },
      });

      return { success: true };
    }),
});
