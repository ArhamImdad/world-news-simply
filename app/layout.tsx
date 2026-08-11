import type { Metadata } from "next";
import { Suspense } from "react";
import { getPublicSiteUrl } from "@/lib/env";
import ScrollToTop from "./scroll-to-top";
import { ThemeProvider } from "./theme-provider";
import "./globals.css";

const siteUrl = getPublicSiteUrl();
const googleAnalyticsId = /^G-[A-Z0-9]+$/.test(process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID || "")
  ? process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID
  : undefined;
const googleVerification = process.env.GOOGLE_SITE_VERIFICATION;

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
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  verification: googleVerification ? { google: googleVerification } : undefined,
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
        {googleAnalyticsId ? (
          <>
            <script async src={`https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsId}`} />
            <script
              dangerouslySetInnerHTML={{
                __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${googleAnalyticsId}', { anonymize_ip: true });
            `,
              }}
            />
          </>
        ) : null}
      </head>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
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
