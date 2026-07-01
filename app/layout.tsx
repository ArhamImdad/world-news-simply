import type { Metadata } from "next";
import { Suspense } from "react";
import { getPublicSiteUrl } from "@/lib/env";
import ScrollToTop from "./scroll-to-top";
import { ThemeProvider } from "./theme-provider";
import "./globals.css";

const siteUrl = getPublicSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "World News Simply | Breaking News in Simple English",
    template: "%s | World News Simply",
  },
  description: "World News Simply - Get the latest breaking news from around the world in simple English. Read clear updates on politics, technology, business, sports, health, and more.",
  alternates: {
    canonical: siteUrl,
  },
  openGraph: {
    title: "World News Simply | Breaking News in Simple English",
    description: "World News Simply - Get the latest breaking news from around the world in simple English.",
    url: siteUrl,
    siteName: "World News Simply",
    type: "website",
    images: [{ url: "/og-default.svg", alt: "World News Simply" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "World News Simply | Breaking News in Simple English",
    description: "World News Simply - Get the latest breaking news from around the world in simple English.",
    images: ["/og-default.svg"],
  },
  robots: {
    index: true,
    follow: true,
  },
  verification: {
    google: "MHFiGDajc6_jJjXyDx0unjDUSFXUm0x6IJKTo0Rkwgg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('world-news-theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}`,
          }}
        />
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-BQ9ME85BTV" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', 'G-BQ9ME85BTV');
            `,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <Suspense fallback={null}>
            <ScrollToTop />
          </Suspense>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
