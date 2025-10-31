import "~/styles/globals.css";

import { type Metadata } from "next";
import { Inter } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ApiProvider } from "~/components/providers/api-provider";
import { ThemeProvider } from "~/components/providers/theme-provider";
import { TailwindIndicator } from "~/components/ui/tailwind-indicator";
import { Toaster } from "~/components/ui/sonner";

export const metadata: Metadata = {
  title: "JARVIS",
  description: "Job Acceleration Reference Visual Interface System",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const geist = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable}`} suppressHydrationWarning>
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
