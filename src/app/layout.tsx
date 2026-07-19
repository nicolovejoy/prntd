import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import { FeedbackLauncher } from "@/components/feedback-launcher";
import { FEEDBACK_PROJECT_ID } from "@/lib/feedback/project-id";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://prntd.org";
const title = "PRNTD — AI-Powered Custom Design";
const description =
  "Design custom apparel and accessories with AI. Describe your idea, generate a unique design, and order it on shirts, phone cases, and more.";

export const metadata: Metadata = {
  // Makes opengraph-image / twitter-image resolve to absolute https URLs.
  metadataBase: new URL(siteUrl),
  title,
  description,
  openGraph: {
    type: "website",
    siteName: "PRNTD",
    url: siteUrl,
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        {children}
        <FeedbackLauncher projectId={FEEDBACK_PROJECT_ID} />
        <Analytics />
      </body>
    </html>
  );
}
