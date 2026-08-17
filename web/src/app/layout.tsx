import "~/styles/globals.css";

import { type Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ApiProvider } from "~/components/providers/api-provider";
import { ThemeProvider } from "~/components/providers/theme-provider";
import { TailwindIndicator } from "~/components/ui/tailwind-indicator";
import { Toaster } from "~/components/ui/sonner";
import { ORIGIN_URL } from "~/config/url";

export const metadata: Metadata = {
  title: "Jarvis Cloud",
  description:
    "Jarvis Cloud is build around J.A.R.V.I.S.(Job Acceleration Reference Visual Interface System) and its designed to be a powerful platform that provides a comprehensive suite of tools and services for developers, businesses, and individuals to accelerate their projects and workflows. With its intuitive interface and robust features, Jarvis Cloud enables users to streamline their development processes, collaborate effectively, and achieve their goals faster.",
  //For the OG image check the opengraph-image.tsx
  openGraph: {
    title: "Jarvis Cloud",
    description:
      "The Jarvis Cloud is a powerful platform that provides a comprehensive suite of tools and services for developers, businesses, and individuals to accelerate their projects and workflows. With its intuitive interface and robust features, Jarvis Cloud enables users to streamline their development processes, collaborate effectively, and achieve their goals faster.",
  },
  icons: [
    { rel: "icon", url: "/icons/JARVIS-favicon-v2.png" },
    { rel: "apple-touch-icon", url: "/icons/JARVIS-favicon-v2.png" },
    { rel: "shortcut icon", url: "/icons/JARVIS-favicon-v2.png" },
  ],
  authors: [{ name: "Jarvis Cloud" }],
  creator: "Jarvis Cloud",
  metadataBase: new URL(ORIGIN_URL),
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  keywords: [
    "jarvis cloud",
    "jarvis web",
    "jarvis",
    "automation",
    "workflow management",
    "job acceleration",
    "visual interface system",
    "developer tools",
    "architecture",
    "cloud",
    "services",
    "project management",
    "collaboration",
    "productivity",
    "cloud computing",
    "software development",
    "technology platform",
    "task automation",
    "workflow automation",
    "business automation",
    "CI/CD pipeline",
    "deployment automation",
    "DevOps tools",
    "cloud platform",
    "SaaS",
    "enterprise software",
    "team collaboration tools",
    "project orchestration",
    "intelligent automation",
    "AI-powered automation",
    "workflow optimization",
    "process automation",
    "agile project management",
    "development platform",
    "API integration",
    "microservices management",
    "low-code automation",
    "visual workflow builder",
    "job scheduling",
    "task scheduling",
    "workflow engine",
    "automation platform as a service",
    "enterprise automation",
    "digital transformation",
  ],
  other: {
    "application/ld+json": JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "JARVIS",
      description: "Job Acceleration Reference Visual Interface System",
      url: ORIGIN_URL,
      applicationCategory: ["Cloud", "Productivity", "Software", "Architecture", "Development", "Technology", "Platform", "Automation", "Workflow Management", "Collaboration", "Project Management"],
    }),
  },
};

const fontSans = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Technical annotation voice: unambiguous 0/O and 1/l at the 10px label size.
const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${fontSans.variable} ${fontMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-dvh flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ApiProvider>
            <NuqsAdapter>
              {children}
              <TailwindIndicator />
              <Toaster position="top-center" />
            </NuqsAdapter>
          </ApiProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
