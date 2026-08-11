import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Quotebook",
  description:
    "A local-first, privacy-respecting notebook for capturing and organizing quotes and dialogues.",
  manifest: "/manifest.json",
  applicationName: "Quotebook",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Quotebook",
    // Dark app chrome — draws the iOS status bar text light-on-dark instead
    // of assuming a light page background.
    statusBarStyle: "black-translucent",
  },
  // The app is a private notebook; keep it out of search results.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1e1f22",
  // Installed PWAs should fill the display, notch included.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-full font-sans">
        <Providers>{children}</Providers>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
