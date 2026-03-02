import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, X } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { NotWhitelistedView } from "@/components/not-whitelisted-view";
import { AuthImage } from "@/components/auth-image";
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

type PhotosSearch = {
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

export const Route = createFileRoute("/photos")({
  component: PhotosRoute,
  validateSearch: (search: Record<string, unknown>): PhotosSearch => ({
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
      throw redirect({ to: "/" });
    }
    return { session };
  },
});

function PhotosRoute() {
  Route.useRouteContext();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const initialExpanded = useMemo(() => new Set(parseExpandedSearch(search.expanded)), [search.expanded]);

  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [albumFilter, setAlbumFilter] = useState<string | null>(search.folder ?? null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(initialExpanded);
  const [currentPage, setCurrentPage] = useState<number>(search.page ?? 1);

  const myRoleQuery = useQuery(trpc.team.getMyRole.queryOptions());
  const isWhitelisted = (myRoleQuery.data?.role ?? null) !== null;

  const albumsQuery = useQuery({
    ...trpc.photos.getAlbums.queryOptions(),
    enabled: isWhitelisted,
  });

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
        to: "/photos",
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
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      persistViewStateToUrl(albumFilter, next, currentPage);
      return next;
    });
  }, [albumFilter, currentPage, persistViewStateToUrl]);

  const selectFolder = useCallback(
    (path: string | null) => {
      setAlbumFilter(path);
      setCurrentPage(1);
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (path) {
          for (const ancestor of getAncestorPaths(path)) {
            next.add(ancestor);
          }
        }
        persistViewStateToUrl(path, next, 1);
        return next;
      });
    },
    [persistViewStateToUrl],
  );

  // Keep local state in sync when URL query changes via navigation/refresh.
  useEffect(() => {
    setAlbumFilter(search.folder ?? null);
    setExpandedFolders(new Set(parseExpandedSearch(search.expanded)));
    setCurrentPage(search.page ?? 1);
  }, [search.folder, search.expanded, search.page]);

  // Ensure the selected folder's branch is always open.
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
      if (changed) {
        persistViewStateToUrl(albumFilter, next, currentPage);
      }
      return changed ? next : prev;
    });
  }, [albumFilter, currentPage, persistViewStateToUrl]);

  const photosQuery = useQuery({
    ...trpc.photos.listPage.queryOptions({
      album: albumFilter ?? undefined,
      page: currentPage,
      limit: 24,
    }),
    enabled: isWhitelisted,
  });

  const photos = photosQuery.data?.items ?? [];
  const selectedPhoto = photos.find((p) => p.id === selectedPhotoId);

  const goToPage = useCallback(
    (nextPage: number) => {
      if (!photosQuery.data) return;
      const clamped = Math.max(1, Math.min(nextPage, photosQuery.data.totalPages));
      setCurrentPage(clamped);
      persistViewStateToUrl(albumFilter, expandedFolders, clamped);
    },
    [albumFilter, expandedFolders, persistViewStateToUrl, photosQuery.data],
  );
  const pageNumbers = useMemo(() => {
    const totalPages = photosQuery.data?.totalPages ?? 1;
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + 4);
    const adjustedStart = Math.max(1, end - 4);
    const pages: number[] = [];
    for (let i = adjustedStart; i <= end; i++) pages.push(i);
    return pages;
  }, [currentPage, photosQuery.data?.totalPages]);

  const handleDownload = useCallback(async () => {
    if (!selectedPhotoId || !selectedPhoto?.filename) return;
    const base = import.meta.env.DEV ? "" : env.VITE_SERVER_URL;
    const url = `${base}/api/photos/download/${selectedPhotoId}`;
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = selectedPhoto.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Fallback: open in new tab (may not work with auth)
      window.open(url, "_blank");
    }
  }, [selectedPhotoId, selectedPhoto?.filename]);

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
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-primary">Gallery</p>
          <h1 className="text-3xl font-bold tracking-tight">Photos</h1>
          <p className="text-muted-foreground">
            Browse your photos by folder. Compressed previews for browsing, full resolution for
            download.
          </p>
        </div>
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
              All photos
            </button>
            {rootFolders.map((node) => {
              const isSelected = albumFilter === node.fullPath;
              const hasChildren = node.children.size > 0;
              const isExpanded = expandedFolders.has(node.fullPath);

              const renderNode = (child: FolderNode, depth: number): React.ReactNode => {
                const childSelected = albumFilter === child.fullPath;
                const childHasChildren = child.children.size > 0;
                const childExpanded = expandedFolders.has(child.fullPath);
                const sortedChildren = Array.from(child.children.values()).sort((a, b) =>
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

                    {childHasChildren && childExpanded && (
                      <div>{sortedChildren.map((nested) => renderNode(nested, depth + 1))}</div>
                    )}
                  </div>
                );
              };

              const sortedChildren = Array.from(node.children.values()).sort((a, b) =>
                a.name.localeCompare(b.name),
              );

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

                  {hasChildren && isExpanded && (
                    <div>{sortedChildren.map((child) => renderNode(child, 1))}</div>
                  )}
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
              {photosQuery.data ? `${photosQuery.data.total.toLocaleString()} photos` : ""}
            </p>
          </div>
          {photosQuery.isLoading ? (
            <div className="flex min-h-[40vh] items-center justify-center">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : photos.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No photos yet</CardTitle>
                <CardDescription>
                  Copy your photos to the import folder and run the import script to get started.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {photos.map((photo) => (
                <Card
                  key={photo.id}
                  className="group cursor-pointer overflow-hidden rounded-2xl border bg-card p-0 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  onClick={() => setSelectedPhotoId(photo.id)}
                >
                  <div className="relative overflow-hidden rounded-2xl bg-muted">
                    <AuthImage
                      photoId={photo.id}
                      type="preview"
                      alt={photo.filename}
                      className="aspect-[4/5] h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                    />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 via-black/25 to-transparent px-2 pb-2 pt-6">
                      <p className="truncate text-xs text-white/90">{photo.filename}</p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {photosQuery.data && photosQuery.data.totalPages > 1 && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 py-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => goToPage(currentPage - 1)}
                disabled={!photosQuery.data.hasPrevPage || photosQuery.isFetching}
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
                  disabled={photosQuery.isFetching}
                >
                  {page}
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => goToPage(currentPage + 1)}
                disabled={!photosQuery.data.hasNextPage || photosQuery.isFetching}
              >
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!selectedPhotoId} onOpenChange={(open) => !open && setSelectedPhotoId(null)}>
        <DialogPopup className="max-h-[92vh] max-w-[min(95vw,1200px)] overflow-hidden rounded-2xl p-0">
          <DialogHeader className="flex flex-row items-center justify-between border-b p-4">
            <DialogTitle className="truncate pr-4">
              {selectedPhoto?.filename ?? "Photo"}
            </DialogTitle>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleDownload}>
                <Download className="mr-2 h-4 w-4" />
                Download
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
            {selectedPhotoId && (
              <div
                className="overflow-hidden rounded-xl bg-background/40 shadow-sm"
                style={{
                  aspectRatio:
                    selectedPhoto?.width && selectedPhoto?.height
                      ? `${selectedPhoto.width} / ${selectedPhoto.height}`
                      : "4 / 3",
                  width: "min(86vw, 1000px)",
                  maxHeight: "68vh",
                  minHeight: "280px",
                }}
              >
                <AuthImage
                  photoId={selectedPhotoId}
                  type="preview"
                  alt={selectedPhoto?.filename ?? ""}
                  className="h-full w-full object-contain"
                />
              </div>
            )}
          </div>
          <DialogFooter className="border-t p-4">
            <p className="text-sm text-muted-foreground">
              {selectedPhoto?.width && selectedPhoto?.height
                ? `${selectedPhoto.width} × ${selectedPhoto.height}`
                : ""}
              {selectedPhoto?.fileSize
                ? ` • ${(selectedPhoto.fileSize / 1024).toFixed(1)} KB`
                : ""}
            </p>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
