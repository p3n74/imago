import { useEffect, useState } from "react";
import { env } from "@template/env/web";

interface AuthImageProps {
  photoId: string;
  type: "preview" | "download";
  alt?: string;
  className?: string;
  onClick?: () => void;
}

/**
 * Fetches image with credentials and displays via blob URL.
 * In dev, uses relative URL (Vite proxy) to avoid CORS; cookies are forwarded by proxy.
 */
export function AuthImage({ photoId, type, alt = "", className, onClick }: AuthImageProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const endpoint = type === "preview" ? "preview" : "download";
  const base = import.meta.env.DEV ? "" : env.VITE_SERVER_URL;
  const url = `${base}/api/photos/${endpoint}/${photoId}`;

  useEffect(() => {
    setSrc(null);
    setError(false);
    let revoked = false;
    let objectUrl: string | null = null;

    fetch(url, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
        const ct = res.headers.get("content-type") ?? "";
        if (!ct.includes("image/")) {
          throw new Error(`Unexpected content-type: ${ct}`);
        }
        return res.blob();
      })
      .then((blob) => {
        if (!revoked) {
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
        }
      })
      .catch((err) => {
        console.warn("[AuthImage] Failed to load", photoId, err);
        setError(true);
      });

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId, type, url]);

  if (error) {
    return (
      <div
        className={`flex items-center justify-center bg-muted text-muted-foreground ${className ?? ""}`}
      >
        Failed to load
      </div>
    );
  }

  if (!src) {
    return (
      <div
        className={`flex items-center justify-center bg-muted animate-pulse ${className ?? ""}`}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onClick={onClick}
      loading="lazy"
      onError={() => setError(true)}
    />
  );
}
