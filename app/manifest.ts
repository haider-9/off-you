import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Stillwave Offline Music",
    short_name: "Stillwave",
    description: "Find and keep freely available audio for offline listening.",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f1e9",
    theme_color: "#f2f1e9",
    icons: [
      { src: "/app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}