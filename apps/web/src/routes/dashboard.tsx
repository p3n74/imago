import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/utils/trpc";
import { NotWhitelistedView } from "@/components/not-whitelisted-view";

type ChartPoint = {
  label: string;
  value: number;
};

function TimeSeriesChart({
  points,
  strokeClassName,
  fillClassName,
}: {
  points: ChartPoint[];
  strokeClassName: string;
  fillClassName: string;
}) {
  const width = 640;
  const height = 220;
  const padding = 24;

  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">No time-series data yet.</p>;
  }

  const maxValue = Math.max(...points.map((p) => p.value), 1);
  const stepX = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;

  const coords = points.map((point, index) => {
    const x = padding + index * stepX;
    const y = height - padding - (point.value / maxValue) * (height - padding * 2);
    return { x, y };
  });

  const linePath = coords
    .map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x} ${coord.y}`)
    .join(" ");
  const areaPath = `${linePath} L ${padding + (points.length - 1) * stepX} ${height - padding} L ${padding} ${height - padding} Z`;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full overflow-visible">
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          className="text-muted-foreground/40"
          stroke="currentColor"
          strokeWidth="1"
        />
        <path d={areaPath} className={`${fillClassName} opacity-25`} />
        <path d={linePath} className={strokeClassName} stroke="currentColor" strokeWidth="3" fill="none" />
        {coords.map((coord, idx) => (
          <circle
            key={idx}
            cx={coord.x}
            cy={coord.y}
            r="3"
            className={strokeClassName}
            fill="currentColor"
          />
        ))}
      </svg>
      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/dashboard")({
  component: RouteComponent,
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

function RouteComponent() {
  const { session } = Route.useRouteContext();

  const roleQueryOptions = trpc.team.getMyRole.queryOptions();
  const roleQuery = useQuery(roleQueryOptions);
  
  const isWhitelisted = (roleQuery.data?.role ?? null) !== null;
  const analyticsQuery = useQuery({
    ...trpc.photos.getAnalytics.queryOptions(),
    enabled: isWhitelisted,
    refetchInterval: 30_000,
  });
  const seriesQuery = useQuery({
    ...trpc.photos.getAnalyticsSeries.queryOptions({ days: 30 }),
    enabled: isWhitelisted,
    refetchInterval: 30_000,
  });

  const formatBytes = (bytes: number | bigint): string => {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = typeof bytes === "bigint" ? Number(bytes) : bytes;
    let unit = 0;

    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }

    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  };

  const getLogScaledPercent = (value: number, max: number): number => {
    if (value <= 0 || max <= 0) return 0;
    const scaled = Math.log10(value + 1) / Math.log10(max + 1);
    return Math.max(0, Math.min(100, scaled * 100));
  };

  const photoCount = analyticsQuery.data?.photoCount ?? 0;
  const videoCount = analyticsQuery.data?.videoCount ?? 0;
  const totalStorageBytes = analyticsQuery.data?.totalStorageBytes ?? 0;
  const totalTrafficBytes = Number(BigInt(analyticsQuery.data?.totalTrafficBytes ?? "0"));

  const photosPercent = getLogScaledPercent(photoCount, 100_000);
  const videosPercent = getLogScaledPercent(videoCount, 100_000);
  const storagePercent = getLogScaledPercent(totalStorageBytes, 5 * 1024 * 1024 * 1024 * 1024);
  const trafficPercent = getLogScaledPercent(totalTrafficBytes, 20 * 1024 * 1024 * 1024 * 1024);

  const photosOverTimePoints: ChartPoint[] =
    seriesQuery.data?.points.map((point) => ({
      label: point.date.slice(5),
      value: point.photosTotal,
    })) ?? [];
  const trafficOverTimePoints: ChartPoint[] =
    seriesQuery.data?.points.map((point) => ({
      label: point.date.slice(5),
      value: Number(BigInt(point.trafficBytes)),
    })) ?? [];

  const metricBars = (percent: number, colorClass: string) => (
    <div className="mt-3 space-y-1.5">
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted/80">
        <div
          className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
          style={{ width: `${Math.max(percent, 2)}%` }}
        />
      </div>
      <div className="grid grid-cols-6 gap-1 opacity-70">
        {Array.from({ length: 18 }).map((_, index) => {
          const threshold = ((index + 1) / 18) * 100;
          return (
            <div
              key={index}
              className={`h-1 rounded ${percent >= threshold ? colorClass : "bg-muted"}`}
            />
          );
        })}
      </div>
    </div>
  );

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
        <h1 className="text-3xl font-bold tracking-tight">Gallery analytics</h1>
        <p className="text-muted-foreground">
          Hello, {session.data?.user?.name ?? "User"}. Live stats for your library and media traffic.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Total photos</CardTitle>
            <CardDescription>Indexed in your gallery database</CardDescription>
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <p className="text-3xl font-semibold">{photoCount.toLocaleString()}</p>
                {metricBars(photosPercent, "bg-blue-500")}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Total videos</CardTitle>
            <CardDescription>Indexed video library items</CardDescription>
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <p className="text-3xl font-semibold">{videoCount.toLocaleString()}</p>
                {metricBars(videosPercent, "bg-amber-500")}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Storage used</CardTitle>
            <CardDescription>Total original file size</CardDescription>
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <p className="text-3xl font-semibold">{formatBytes(totalStorageBytes)}</p>
                {metricBars(storagePercent, "bg-emerald-500")}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Total traffic sent</CardTitle>
            <CardDescription>Preview + download bytes served</CardDescription>
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <p className="text-3xl font-semibold">{formatBytes(totalTrafficBytes)}</p>
                {metricBars(trafficPercent, "bg-violet-500")}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Photos over time</CardTitle>
            <CardDescription>Running total for the last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            {seriesQuery.isLoading ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <TimeSeriesChart
                points={photosOverTimePoints}
                strokeClassName="text-blue-500"
                fillClassName="fill-blue-500"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Traffic over time</CardTitle>
            <CardDescription>Daily bytes served for previews and downloads</CardDescription>
          </CardHeader>
          <CardContent>
            {seriesQuery.isLoading ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <TimeSeriesChart
                points={trafficOverTimePoints}
                strokeClassName="text-violet-500"
                fillClassName="fill-violet-500"
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
