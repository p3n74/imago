import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, Trash2, UserPlus, Shield, Mail, LockKeyhole } from "lucide-react";

import { NotWhitelistedView } from "@/components/not-whitelisted-view";

import { authClient } from "@/lib/auth-client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PresenceStatusIndicator } from "@/components/presence-status";
import { usePresence } from "@/hooks/usePresence";
import { queryClient, trpc } from "@/utils/trpc";
import { toast } from "sonner";

export const Route = createFileRoute("/team")({
  component: TeamRoute,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({
        to: "/login",
      });
    }
    return { session };
  },
});

const ROLES = [
  { value: "ADMIN", label: "Administrator" },
  { value: "USER", label: "User" },
];

function TeamRoute() {
  const { session } = Route.useRouteContext();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [confirmRemoveUserId, setConfirmRemoveUserId] = useState<string | null>(null);
  const [permissionsUserEmail, setPermissionsUserEmail] = useState<string | null>(null);
  const [permissionsUserLabel, setPermissionsUserLabel] = useState<string | null>(null);
  const [formState, setFormState] = useState({
    email: "",
    role: "USER",
  });

  const myRoleQueryOptions = trpc.team.getMyRole.queryOptions();
  const myRoleQuery = useQuery(myRoleQueryOptions);
  const isWhitelisted = (myRoleQuery.data?.role ?? null) !== null;

  const teamQueryOptions = trpc.team.list.queryOptions();
  const teamQuery = useQuery({ ...teamQueryOptions, enabled: isWhitelisted });
  type TeamMember = NonNullable<typeof teamQuery.data>[number];
  
  const isAdmin = myRoleQuery.data?.role === "ADMIN";
  const isPermissionsDialogOpen = permissionsUserEmail !== null;

  const teamUserIds = (teamQuery.data ?? [])
    .map((u: TeamMember) => u.registeredUser?.id)
    .filter((id: string | undefined): id is string => !!id);
  const { statuses: presenceStatuses } = usePresence(teamUserIds, !!teamQuery.data?.length);

  const addMemberMutation = useMutation(
    trpc.team.add.mutationOptions({
      onSuccess: (user) => {
        queryClient.invalidateQueries({ queryKey: teamQueryOptions.queryKey });
        setFormState({ email: "", role: "USER" });
        setIsAddDialogOpen(false);
        toast.success("User authorized successfully");
        openAccessEmail(user.email, user.role);
      },
      onError: (err) => {
        toast.error(`Failed to add user: ${err.message}`);
      }
    }),
  );

  const removeMemberMutation = useMutation(
    trpc.team.remove.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: teamQueryOptions.queryKey });
        setConfirmRemoveUserId(null);
        toast.success("User removed successfully");
      },
      onError: (err) => {
        toast.error(`Failed to remove user: ${err.message}`);
      }
    }),
  );

  const topFoldersQueryOptions = trpc.team.listTopFolders.queryOptions();
  const topFoldersQuery = useQuery({
    ...topFoldersQueryOptions,
    enabled: isAdmin,
  });
  const folderPoliciesQueryOptions = trpc.team.listFolderPolicies.queryOptions();
  const folderPoliciesQuery = useQuery({
    ...folderPoliciesQueryOptions,
    enabled: isAdmin,
  });
  const deniedFolders = (folderPoliciesQuery.data ?? [])
    .filter((p) => p.defaultDeny)
    .map((p) => p.folder);
  const deniedFolderSet = new Set(deniedFolders);

  const userFolderPermissionsQueryOptions = trpc.team.listUserFolderPermissions.queryOptions(
    { email: permissionsUserEmail ?? "" },
  );
  const userFolderPermissionsQuery = useQuery({
    ...userFolderPermissionsQueryOptions,
    enabled: isAdmin && !!permissionsUserEmail,
  });
  const allowedFolderSet = new Set(
    (userFolderPermissionsQuery.data ?? [])
      .filter((p) => p.allow)
      .map((p) => p.folder),
  );

  const setFolderPolicyMutation = useMutation(
    trpc.team.setFolderPolicy.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: folderPoliciesQueryOptions.queryKey });
        toast.success("Folder policy updated");
      },
      onError: (err) => {
        toast.error(`Failed to update folder policy: ${err.message}`);
      },
    }),
  );

  const setUserFolderPermissionMutation = useMutation(
    trpc.team.setUserFolderPermission.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: userFolderPermissionsQueryOptions.queryKey });
      },
      onError: (err) => {
        toast.error(`Failed to update folder access: ${err.message}`);
      },
    }),
  );

  const getAccessEmailContent = (email: string, role: string) => {
    const appUrl =
      typeof window !== "undefined" ? `${window.location.origin}/login` : "https://your-domain/login";
    const subject = "Imago Access Granted";
    const body = [
      `Hello ${email},`,
      "",
      "You have been granted access to Imago.",
      `Role: ${role}`,
      "",
      `Sign in here: ${appUrl}`,
      "",
      "If you expected a different role, contact your administrator.",
      "",
      "Best regards,",
      "Imago Team",
    ].join("\n");

    return {
      subject,
      body,
      mailto: `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    };
  };

  const openAccessEmail = (email: string, role: string) => {
    const content = getAccessEmailContent(email, role);
    window.location.href = content.mailto;
  };

  if (myRoleQuery.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (myRoleQuery.isSuccess && !isWhitelisted) {
    return <NotWhitelistedView />;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.email.trim()) {
      toast.error("Please fill out all required fields.");
      return;
    }
    // @ts-ignore - Role enum typing
    addMemberMutation.mutate(formState);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-4 px-3 py-4 sm:gap-6 sm:px-4 sm:py-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-primary">Management</p>
          <h1 className="text-3xl font-bold tracking-tight">Team & Permissions</h1>
          <p className="text-muted-foreground">
            Manage authorized users and their roles.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Add User
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Authorized Users</CardTitle>
          <CardDescription>
            Only users in this list can access the system after signing in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {teamQuery.isLoading ? (
            <div className="py-8 text-center text-muted-foreground">Loading users...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-y border-border/50 bg-muted/30 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-medium">User</th>
                    <th className="px-5 py-3 font-medium">Email</th>
                    <th className="px-5 py-3 font-medium">Role</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Added</th>
                    {isAdmin && <th className="px-5 py-3 font-medium text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {teamQuery.data?.map((user: TeamMember) => (
                    <tr
                      key={user.id}
                      className="border-b border-border/30 last:border-0 hover:bg-muted/20"
                    >
                      <td className="px-5 py-4">
                        {user.registeredUser ? (
                          <div className="flex items-center gap-3">
                            {user.registeredUser.image ? (
                              <img 
                                src={user.registeredUser.image} 
                                alt={user.registeredUser.name ?? "User"} 
                                className="h-8 w-8 rounded-full bg-muted object-cover" 
                              />
                            ) : (
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
                                {(user.registeredUser.name ?? "U").charAt(0)}
                              </div>
                            )}
                            <span className="font-medium">{user.registeredUser.name ?? "Unknown User"}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground italic">Not registered</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">{user.email}</td>
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                          <Shield className="h-3 w-3" />
                          {user.role}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {user.registeredUser ? (
                          <PresenceStatusIndicator
                            status={presenceStatuses[user.registeredUser.id] ?? "offline"}
                            showLabel
                            size="md"
                          />
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                            Pending Signup
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                      {isAdmin && (
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                              onClick={() => {
                                setPermissionsUserEmail(user.email);
                                setPermissionsUserLabel(user.registeredUser?.name ?? user.email);
                              }}
                              title="Manage folder access"
                            >
                              <LockKeyhole className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                              onClick={() => openAccessEmail(user.email, user.role)}
                              title="Send access email"
                            >
                              <Mail className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-rose-500 hover:bg-rose-500/10 hover:text-rose-600"
                              onClick={() => setConfirmRemoveUserId(user.id)}
                              disabled={user.email === session.data?.user.email} // Prevent self-delete
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                  {teamQuery.data?.length === 0 && (
                    <tr>
                      <td colSpan={isAdmin ? 6 : 5} className="px-5 py-8 text-center text-muted-foreground">
                        No authorized users found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Top-Level Folder Policies</CardTitle>
            <CardDescription>
              Mark folders as hidden by default. Hidden folders only appear for users you explicitly
              allow.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {topFoldersQuery.isLoading || folderPoliciesQuery.isLoading ? (
              <div className="py-8 text-center text-muted-foreground">Loading folder policies...</div>
            ) : (topFoldersQuery.data?.length ?? 0) === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                No folders detected yet. Import media first.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-y border-border/50 bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 font-medium">Top Folder</th>
                      <th className="px-5 py-3 font-medium">Deny by Default</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(topFoldersQuery.data ?? []).map((folder) => {
                      const isDenied = deniedFolderSet.has(folder);
                      const isSaving =
                        setFolderPolicyMutation.isPending &&
                        setFolderPolicyMutation.variables?.folder === folder;
                      return (
                        <tr key={folder} className="border-b border-border/30 last:border-0">
                          <td className="px-5 py-4 font-medium">{folder}</td>
                          <td className="px-5 py-4">
                            <label className="inline-flex cursor-pointer items-center gap-2">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-input"
                                checked={isDenied}
                                disabled={isSaving}
                                onChange={(e) => {
                                  setFolderPolicyMutation.mutate({
                                    folder,
                                    defaultDeny: e.target.checked,
                                  });
                                }}
                              />
                              <span className="text-muted-foreground">
                                {isDenied ? "Hidden unless allowed" : "Visible to all"}
                              </span>
                            </label>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Add Authorized User</DialogTitle>
            <DialogDescription>
              Authorize a new user by email.
            </DialogDescription>
          </DialogHeader>
          <form noValidate onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="user@example.com"
                value={formState.email}
                onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <select
                id="role"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={formState.role}
                onChange={(e) => setFormState({ ...formState, role: e.target.value })}
                required
              >
                {ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>
            <DialogFooter className="mt-6">
              <DialogClose className={buttonVariants({ variant: "outline" })}>
                Cancel
              </DialogClose>
              <Button type="submit" disabled={addMemberMutation.isPending}>
                {addMemberMutation.isPending ? "Adding..." : "Add User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      <ConfirmDialog
        open={!!confirmRemoveUserId}
        onOpenChange={(open) => !open && setConfirmRemoveUserId(null)}
        title="Remove user"
        description="Are you sure you want to remove this user? They will lose access to the system."
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={() => {
          if (confirmRemoveUserId) {
            removeMemberMutation.mutate({ id: confirmRemoveUserId });
          }
        }}
        loading={removeMemberMutation.isPending}
      />

      <Dialog
        open={isPermissionsDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setPermissionsUserEmail(null);
            setPermissionsUserLabel(null);
          }
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Folder Access Overrides</DialogTitle>
            <DialogDescription>
              {permissionsUserLabel
                ? `Grant access for deny-by-default folders to ${permissionsUserLabel}.`
                : "Grant access for deny-by-default folders."}
            </DialogDescription>
          </DialogHeader>

          {!permissionsUserEmail ? null : deniedFolders.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No folders are deny-by-default right now.
            </div>
          ) : userFolderPermissionsQuery.isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="max-h-[45vh] space-y-2 overflow-auto pr-1">
              {deniedFolders.map((folder) => {
                const isAllowed = allowedFolderSet.has(folder);
                const isSaving =
                  setUserFolderPermissionMutation.isPending &&
                  setUserFolderPermissionMutation.variables?.folder === folder &&
                  setUserFolderPermissionMutation.variables?.email === permissionsUserEmail;
                return (
                  <label
                    key={folder}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <div>
                      <p className="font-medium">{folder}</p>
                      <p className="text-xs text-muted-foreground">
                        {isAllowed ? "Allowed for this user" : "Hidden for this user"}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input"
                      checked={isAllowed}
                      disabled={isSaving}
                      onChange={(e) => {
                        if (!permissionsUserEmail) return;
                        setUserFolderPermissionMutation.mutate({
                          email: permissionsUserEmail,
                          folder,
                          allow: e.target.checked,
                        });
                      }}
                    />
                  </label>
                );
              })}
            </div>
          )}

          <DialogFooter className="mt-4">
            <DialogClose className={buttonVariants({ variant: "outline" })}>Close</DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
