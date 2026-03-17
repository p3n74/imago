import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { extractTopFolder } from "@template/db/media-permissions";
import { protectedProcedure, router, whitelistedProcedure, adminProcedure } from "../index";

const ROLES = ["ADMIN", "USER"] as const;

function normalizeTopFolderInput(folder: string): string {
  const topFolder = extractTopFolder(folder);
  if (!topFolder) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid folder value.",
    });
  }
  return topFolder;
}

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

  listTopFolders: adminProcedure.query(async ({ ctx }) => {
    const [photoAlbums, videoAlbums] = await Promise.all([
      ctx.prisma.photo.findMany({
        select: { album: true },
        where: { album: { not: null } },
        distinct: ["album"],
      }),
      ctx.prisma.video.findMany({
        select: { album: true },
        where: { album: { not: null } },
        distinct: ["album"],
      }),
    ]);

    const topFolders = new Set<string>();
    for (const album of [...photoAlbums, ...videoAlbums]) {
      const top = extractTopFolder(album.album);
      if (top) topFolders.add(top);
    }

    return Array.from(topFolders).sort((a, b) => a.localeCompare(b));
  }),

  listFolderPolicies: adminProcedure.query(async ({ ctx }) => {
    const policies = await ctx.prisma.folderPolicy.findMany({
      orderBy: { folder: "asc" },
      select: {
        id: true,
        folder: true,
        defaultDeny: true,
        updatedAt: true,
        updatedBy: true,
      },
    });
    return policies;
  }),

  setFolderPolicy: adminProcedure
    .input(
      z.object({
        folder: z.string().min(1),
        defaultDeny: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const folder = normalizeTopFolderInput(input.folder);
      const actorEmail = ctx.session.user.email;

      if (input.defaultDeny) {
        const policy = await ctx.prisma.folderPolicy.upsert({
          where: { folder },
          create: {
            folder,
            defaultDeny: true,
            createdBy: actorEmail,
            updatedBy: actorEmail,
          },
          update: {
            defaultDeny: true,
            updatedBy: actorEmail,
          },
        });
        return policy;
      }

      await ctx.prisma.folderPolicy.deleteMany({
        where: { folder },
      });
      return { folder, defaultDeny: false };
    }),

  listUserFolderPermissions: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
      })
    )
    .query(async ({ ctx, input }) => {
      const permissions = await ctx.prisma.folderPermission.findMany({
        where: { email: input.email },
        orderBy: { folder: "asc" },
        select: {
          id: true,
          email: true,
          folder: true,
          allow: true,
          updatedAt: true,
        },
      });
      return permissions;
    }),

  setUserFolderPermission: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        folder: z.string().min(1),
        allow: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const folder = normalizeTopFolderInput(input.folder);
      const actorEmail = ctx.session.user.email;
      const authorizedUser = await ctx.prisma.authorizedUser.findUnique({
        where: { email: input.email },
      });
      if (!authorizedUser) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User is not in the authorized list.",
        });
      }

      if (input.allow) {
        const permission = await ctx.prisma.folderPermission.upsert({
          where: {
            email_folder: {
              email: input.email,
              folder,
            },
          },
          create: {
            email: input.email,
            folder,
            allow: true,
            createdBy: actorEmail,
          },
          update: {
            allow: true,
          },
        });
        return permission;
      }

      await ctx.prisma.folderPermission.deleteMany({
        where: {
          email: input.email,
          folder,
        },
      });
      return { email: input.email, folder, allow: false };
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
      await ctx.prisma.folderPermission.deleteMany({
        where: { email: user.email },
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
