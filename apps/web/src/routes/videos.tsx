import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, Play, X } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { NotWhitelistedView } from "@/components/not-whitelisted-view";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/utils/trpc";
import { env } from "@template/env/web";

type FolderNode = {
  name: string;
  fullPath: string;
  children: Map<string, FolderNode>;
};

type VideosSearch = {
  folder?: string;
  expanded?: string;
  page?: number;
};

function parseExpandedSearch(value?: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

function serializeExpandedSearch(paths: Set<string>): string | undefined {
  if (paths.size === 0) return undefined;
  return JSON.stringify(Array.from(paths).sort((a, b) => a.localeCompare(b)));
}

function getAncestorPaths(folderPath: string): string[] {
  const parts = folderPath.split("/").filter(Boolean);
  if (parts.length <= 1) return [];
  const ancestors: string[] = [];
  let current = "";
  for (let i = 0; i < parts.length - 1; i++) {
    current = current ? `${current}/${parts[i]}` : (parts[i] ?? "");
    if (current) ancestors.push(current);
  }
  return ancestors;
}

function buildFolderTree(albums: string[]): FolderNode {
  const root: FolderNode = { name: "", fullPath: "", children: new Map() };

  for (const album of albums) {
    const parts = album.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let current = root;
    let currentPath = "";

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          fullPath: currentPath,
          children: new Map(),
        });
      }
      current = current.children.get(part)!;
    }
  }

  return root;
}

function formatDuration(seconds?: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) return "Unknown";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "Unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

type VideoCardItem = {
  id: string;
  filename: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  fileSize: number | null;
};

function VideoCard({
  video,
  streamUrl,
  downloadUrl,
  onOpen,
}: {
  video: VideoCardItem;
  streamUrl: string;
  downloadUrl: string;
  onOpen: () => void;
}) {
  const [loadedDuration, setLoadedDuration] = useState<number | null>(null);
  const [loadedWidth, setLoadedWidth] = useState<number | null>(null);
  const [loadedHeight, setLoadedHeight] = useState<number | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  const duration = video.durationSeconds ?? loadedDuration;
  const width = video.width ?? loadedWidth;
  const height = video.height ?? loadedHeight;

  return (
    <Card
      className="group cursor-pointer overflow-hidden rounded-xl border bg-card p-0 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      onClick={onOpen}
    >
      <div className="relative aspect-video bg-black">
        {!previewFailed ? (
          <video
            className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100"
            preload="metadata"
            muted
            playsInline
            src={downloadUrl}
            onLoadedMetadata={(e) => {
              setLoadedDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : null);
              setLoadedWidth(e.currentTarget.videoWidth || null);
              setLoadedHeight(e.currentTarget.videoHeight || null);
            }}
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-white/70">
            <Play className="h-8 w-8" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-3 text-white">
          <p className="truncate text-sm font-medium">{video.filename}</p>
          <p className="text-xs text-white/80">
            {duration ? formatDuration(duration) : "Duration loading..."}
            {" • "}
            {width && height ? `${width} × ${height}` : "Resolution loading..."}
          </p>
        </div>
        <button
          type="button"
          aria-label="Play video"
          className="absolute right-3 top-3 rounded-full bg-black/50 p-2 text-white backdrop-blur-sm"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          <Play className="h-4 w-4" />
        </button>
      </div>
      <div className="px-3 py-2">
        <p className="text-xs text-muted-foreground">{formatBytes(video.fileSize)}</p>
      </div>
    </Card>
  );
}

export const Route = createFileRoute("/videos")({
  component: VideosRoute,
  validateSearch: (search: Record<string, unknown>): VideosSearch => ({
    folder: typeof search.folder === "string" ? search.folder : undefined,
    expanded: typeof search.expanded === "string" ? search.expanded : undefined,
    page: (() => {
      if (typeof search.page === "number" && Number.isInteger(search.page) && search.page > 0) {
        return search.page;
      }
      if (typeof search.page === "string") {
        const parsed = Number.parseInt(search.page, 10);
        if (Number.isInteger(parsed) && parsed > 0) return parsed;
      }
      return undefined;
    })(),
  }),
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({ to: "/login" });
    }
    return { session };
  },
});

function VideosRoute() {
  Route.useRouteContext();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const initialExpanded = useMemo(() => new Set(parseExpandedSearch(search.expanded)), [search.expanded]);

  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [albumFilter, setAlbumFilter] = useState<string | null>(search.folder ?? null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(initialExpanded);
  const [currentPage, setCurrentPage] = useState<number>(search.page ?? 1);

  const myRoleQuery = useQuery(trpc.team.getMyRole.queryOptions());
  const isWhitelisted = (myRoleQuery.data?.role ?? null) !== null;

  const albumsQuery = useQuery({
    ...trpc.videos.getAlbums.queryOptions(),
    enabled: isWhitelisted,
  });
  const videosQuery = useQuery({
    ...trpc.videos.listPage.queryOptions({
      album: albumFilter ?? undefined,
      page: currentPage,
      limit: 24,
    }),
    enabled: isWhitelisted,
  });

  const videos = videosQuery.data?.items ?? [];
  const selectedVideo = videos.find((v) => v.id === selectedVideoId) ?? null;

  const folderTree = useMemo(
    () => (albumsQuery.data ? buildFolderTree(albumsQuery.data) : null),
    [albumsQuery.data],
  );
  const rootFolders = useMemo(
    () =>
      folderTree
        ? Array.from(folderTree.children.values()).sort((a, b) => a.name.localeCompare(b.name))
        : [],
    [folderTree],
  );

  const persistViewStateToUrl = useCallback(
    (nextAlbumFilter: string | null, nextExpanded: Set<string>, nextPage: number) => {
      navigate({
        to: "/videos",
        replace: true,
        search: {
          folder: nextAlbumFilter ?? undefined,
          expanded: serializeExpandedSearch(nextExpanded),
          page: nextPage > 1 ? nextPage : undefined,
        },
      });
    },
    [navigate],
  );

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const selectFolder = useCallback(
    (path: string | null) => {
      setAlbumFilter(path);
      setCurrentPage(1);
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (path) {
          for (const ancestor of getAncestorPaths(path)) next.add(ancestor);
        }
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    setAlbumFilter(search.folder ?? null);
    setExpandedFolders(new Set(parseExpandedSearch(search.expanded)));
    setCurrentPage(search.page ?? 1);
  }, [search.folder, search.expanded, search.page]);

  useEffect(() => {
    if (!albumFilter) return;
    const ancestors = getAncestorPaths(albumFilter);
    if (ancestors.length === 0) return;
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const ancestor of ancestors) {
        if (!next.has(ancestor)) {
          next.add(ancestor);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [albumFilter]);

  const goToPage = useCallback(
    (nextPage: number) => {
      if (!videosQuery.data) return;
      const clamped = Math.max(1, Math.min(nextPage, videosQuery.data.totalPages));
      setCurrentPage(clamped);
    },
    [videosQuery.data],
  );
  const pageNumbers = useMemo(() => {
    const totalPages = videosQuery.data?.totalPages ?? 1;
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + 4);
    const adjustedStart = Math.max(1, end - 4);
    const pages: number[] = [];
    for (let i = adjustedStart; i <= end; i++) pages.push(i);
    return pages;
  }, [currentPage, videosQuery.data?.totalPages]);

  const handleDownload = useCallback(async () => {
    if (!selectedVideoId || !selectedVideo?.filename) return;
    const base = import.meta.env.DEV ? "" : env.VITE_SERVER_URL;
    const url = `${base}/api/videos/download/${selectedVideoId}`;
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = selectedVideo.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(url, "_blank");
    }
  }, [selectedVideoId, selectedVideo?.filename]);

  const getStreamUrl = useCallback((id: string, quality: "low" | "med" | "high" = "med") => {
    const base = import.meta.env.DEV ? "" : env.VITE_SERVER_URL;
    return `${base}/api/videos/stream/${id}?quality=${quality}`;
  }, []);

  useEffect(() => {
    const nextExpanded = serializeExpandedSearch(expandedFolders);
    const nextPage = currentPage > 1 ? currentPage : undefined;
    if (
      search.folder === (albumFilter ?? undefined) &&
      search.expanded === nextExpanded &&
      search.page === nextPage
    ) {
      return;
    }
    persistViewStateToUrl(albumFilter, expandedFolders, currentPage);
  }, [
    albumFilter,
    expandedFolders,
    currentPage,
    persistViewStateToUrl,
    search.folder,
    search.expanded,
    search.page,
  ]);

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

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-4 px-3 py-4 sm:gap-6 sm:px-4 sm:py-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-primary">Gallery</p>
        <h1 className="text-3xl font-bold tracking-tight">Videos</h1>
        <p className="text-muted-foreground">
          Stream compressed videos on demand or download the original files.
        </p>
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
        <div className="w-full max-w-xs rounded-lg border bg-background p-3 text-sm md:w-64">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Folders
          </p>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => selectFolder(null)}
              className={[
                "flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition",
                albumFilter === null
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent hover:text-accent-foreground",
              ].join(" ")}
            >
              All videos
            </button>
            {rootFolders.map((node) => {
              const isSelected = albumFilter === node.fullPath;
              const hasChildren = node.children.size > 0;
              const isExpanded = expandedFolders.has(node.fullPath);
              const sortedChildren = Array.from(node.children.values()).sort((a, b) =>
                a.name.localeCompare(b.name),
              );

              const renderNode = (child: FolderNode, depth: number): React.ReactNode => {
                const childSelected = albumFilter === child.fullPath;
                const childHasChildren = child.children.size > 0;
                const childExpanded = expandedFolders.has(child.fullPath);
                const nested = Array.from(child.children.values()).sort((a, b) =>
                  a.name.localeCompare(b.name),
                );
                return (
                  <div key={child.fullPath}>
                    <div
                      className="flex items-center gap-1 rounded-md pr-2"
                      style={{ paddingLeft: `${depth * 12}px` }}
                    >
                      {childHasChildren ? (
                        <button
                          type="button"
                          onClick={() => toggleFolder(child.fullPath)}
                          className="rounded p-1 hover:bg-accent"
                          aria-label={childExpanded ? "Collapse folder" : "Expand folder"}
                        >
                          <ChevronRight
                            className={`h-3.5 w-3.5 transition-transform ${childExpanded ? "rotate-90" : ""}`}
                          />
                        </button>
                      ) : (
                        <span className="w-5" />
                      )}
                      <button
                        type="button"
                        onClick={() => selectFolder(child.fullPath)}
                        className={[
                          "flex-1 rounded-md px-2 py-1.5 text-left text-sm transition",
                          childSelected
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-accent hover:text-accent-foreground",
                        ].join(" ")}
                      >
                        {child.name}
                      </button>
                    </div>
                    {childHasChildren && childExpanded && <div>{nested.map((n) => renderNode(n, depth + 1))}</div>}
                  </div>
                );
              };

              return (
                <div key={node.fullPath}>
                  <div className="flex items-center gap-1 rounded-md pr-2">
                    {hasChildren ? (
                      <button
                        type="button"
                        onClick={() => toggleFolder(node.fullPath)}
                        className="rounded p-1 hover:bg-accent"
                        aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
                      >
                        <ChevronRight
                          className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        />
                      </button>
                    ) : (
                      <span className="w-5" />
                    )}
                    <button
                      type="button"
                      onClick={() => selectFolder(node.fullPath)}
                      className={[
                        "flex-1 rounded-md px-2 py-1.5 text-left text-sm transition",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-accent hover:text-accent-foreground",
                      ].join(" ")}
                    >
                      {node.name}
                    </button>
                  </div>
                  {hasChildren && isExpanded && <div>{sortedChildren.map((child) => renderNode(child, 1))}</div>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex-1">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card/40 px-3 py-2">
            <p className="text-sm text-muted-foreground">
              {albumFilter ? `Folder: ${albumFilter}` : "All folders"}
            </p>
            <p className="text-sm text-muted-foreground">
              {videosQuery.data ? `${videosQuery.data.total.toLocaleString()} videos` : ""}
            </p>
          </div>
          {videosQuery.isLoading ? (
            <div className="flex min-h-[40vh] items-center justify-center">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : videos.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No videos yet</CardTitle>
                <CardDescription>
                  Copy videos to the import folder and run the import script to index them.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {videos.map((video) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  streamUrl={getStreamUrl(video.id, "low")}
                  downloadUrl={`${import.meta.env.DEV ? "" : env.VITE_SERVER_URL}/api/videos/download/${video.id}`}
                  onOpen={() => setSelectedVideoId(video.id)}
                />
              ))}
            </div>
          )}

          {videosQuery.data && videosQuery.data.totalPages > 1 && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 py-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => goToPage(currentPage - 1)}
                disabled={!videosQuery.data.hasPrevPage || videosQuery.isFetching}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Prev
              </Button>
              {pageNumbers.map((page) => (
                <Button
                  key={page}
                  variant={page === currentPage ? "default" : "outline"}
                  size="sm"
                  onClick={() => goToPage(page)}
                  disabled={videosQuery.isFetching}
                >
                  {page}
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => goToPage(currentPage + 1)}
                disabled={!videosQuery.data.hasNextPage || videosQuery.isFetching}
              >
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!selectedVideoId} onOpenChange={(open) => !open && setSelectedVideoId(null)}>
        <DialogPopup className="max-h-[92vh] max-w-[min(95vw,1200px)] overflow-hidden rounded-2xl p-0">
          <DialogHeader className="flex flex-row items-center justify-between border-b p-4">
            <DialogTitle className="truncate pr-4">
              {selectedVideo?.filename ?? "Video"}
            </DialogTitle>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleDownload}>
                <Download className="mr-2 h-4 w-4" />
                Download Original
              </Button>
              <DialogClose
                className={buttonVariants({ variant: "ghost", size: "icon" })}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </DialogClose>
            </div>
          </DialogHeader>
          <div className="flex items-center justify-center overflow-auto bg-muted/70 p-4">
            {selectedVideoId && (
              <video
                controls
                preload="metadata"
                className="max-h-[70vh] w-full rounded-xl bg-black"
                src={getStreamUrl(selectedVideoId, "med")}
              />
            )}
          </div>
          <DialogFooter className="border-t p-4">
            <p className="text-sm text-muted-foreground">
              {selectedVideo?.durationSeconds ? `${formatDuration(selectedVideo.durationSeconds)} • ` : ""}
              {formatBytes(selectedVideo?.fileSize)}
            </p>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
