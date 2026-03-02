import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/utils/trpc";
import { NotWhitelistedView } from "@/components/not-whitelisted-view";

export const Route = createFileRoute("/dashboard")({
  component: RouteComponent,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({
        to: "/",
      });
    }
    return { session };
  },
});

function RouteComponent() {
  const { session } = Route.useRouteContext();

  const roleQueryOptions = trpc.team.getMyRole.queryOptions();
  const roleQuery = useQuery(roleQueryOptions);
  
  const isWhitelisted = (roleQuery.data?.role ?? null) !== null;

  if (roleQuery.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (roleQuery.isSuccess && !isWhitelisted) {
    return <NotWhitelistedView />;
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-4 px-3 py-4 sm:gap-6 sm:px-4 sm:py-6">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-widest text-primary">Dashboard</p>
        <h1 className="text-3xl font-bold tracking-tight">Welcome to Imago</h1>
        <p className="text-muted-foreground">
          Hello, {session.data?.user?.name ?? "User"}. You are logged in with the role: {roleQuery.data?.role ?? "None"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Authentication</CardTitle>
            <CardDescription>Better-Auth integration</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Secure authentication using Better-Auth with support for multiple providers.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>API Layer</CardTitle>
            <CardDescription>tRPC + TanStack Query</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              End-to-end type safety with tRPC and powerful data fetching with TanStack Query.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>UI Components</CardTitle>
            <CardDescription>shadcn/ui + Tailwind CSS</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Beautifully designed components built with Radix UI and Tailwind CSS.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Getting Started</CardTitle>
          <CardDescription>How to use this template</CardDescription>
        </CardHeader>
        <CardContent className="prose prose-sm dark:prose-invert max-w-none">
          <p>
            This template provides a solid foundation for building modern web applications. 
            It includes a pre-configured monorepo structure, authentication, type-safe API, and a clean UI.
          </p>
          <ul>
            <li><strong>apps/web</strong>: React frontend with TanStack Router.</li>
            <li><strong>apps/server</strong>: Express backend with tRPC.</li>
            <li><strong>packages/api</strong>: Shared tRPC router definitions.</li>
            <li><strong>packages/db</strong>: Prisma schema and database client.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
