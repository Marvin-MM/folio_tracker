import type { MetadataRoute } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_TAGLINE,
    start_url: "/app/inbox",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#F9F8F6",
    theme_color: "#F9F8F6",
    categories: ["productivity", "lifestyle"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
    shortcuts: [
      {
        name: "Today",
        short_name: "Today",
        description: "Open Today's tasks and daily habits",
        url: "/app/today",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Habits",
        short_name: "Habits",
        description: "Open monthly habit calendar matrix",
        url: "/app/habits",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Notes",
        short_name: "Notes",
        description: "Browse quiet and timed markdown notes",
        url: "/app/notes",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Reminders",
        short_name: "Reminders",
        description: "Manage scheduled reminders",
        url: "/app/reminders",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
