import "~/styles/globals.css";

import { type Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
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
