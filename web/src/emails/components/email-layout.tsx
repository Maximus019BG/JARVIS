import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Tailwind,
} from "@react-email/components";
import type React from "react";

interface EmailLayoutProps {
  preview: string;
  children: React.ReactNode;
}

export const EmailLayout = ({ preview, children }: EmailLayoutProps) => (
  <Html>
    <Tailwind
      config={{
        theme: {
          extend: {
            fontFamily: {
              sans: [
                "Geist",
                "var(--font-geist-sans)",
                "ui-sans-serif",
                "system-ui",
                "sans-serif",
                "Apple Color Emoji",
                "Segoe UI Emoji",
                "Segoe UI Symbol",
                "Noto Color Emoji",
              ],
            },
            borderRadius: {
              sm: "0.375rem",
              md: "0.5rem",
              lg: "0.625rem",
              xl: "0.875rem",
            },
            colors: {
              background: "oklch(0.145 0 0)", // dark
              foreground: "oklch(0.985 0 0)",
              card: "oklch(0.205 0 0)",
              "card-foreground": "oklch(0.985 0 0)",
              popover: "oklch(0.205 0 0)",
              "popover-foreground": "oklch(0.985 0 0)",
              primary: "oklch(0.5506 0.1038 174.82)",
              "primary-foreground": "oklch(0.205 0 0)",
              secondary: "oklch(0.269 0 0)",
              "secondary-foreground": "oklch(0.985 0 0)",
              muted: "oklch(0.269 0 0)",
              "muted-foreground": "oklch(0.708 0 0)",
              accent: "oklch(0.269 0 0)",
              "accent-foreground": "oklch(0.985 0 0)",
              destructive: "oklch(0.704 0.191 22.216)",
              border: "oklch(1 0 0 / 10%)",
              input: "oklch(1 0 0 / 15%)",
              ring: "oklch(0.556 0 0)",
              sidebar: "oklch(0.205 0 0)",
              "sidebar-foreground": "oklch(0.985 0 0)",
              "sidebar-primary": "oklch(0.488 0.243 264.376)",
              "sidebar-primary-foreground": "oklch(0.985 0 0)",
              "sidebar-accent": "oklch(0.269 0 0)",
              "sidebar-accent-foreground": "oklch(0.985 0 0)",
              "sidebar-border": "oklch(1 0 0 / 10%)",
              "sidebar-ring": "oklch(0.556 0 0)",
            },
          },
        },
      }}
    >
      <Head />
      <Preview>{preview}</Preview>
      <Body className="bg-muted p-2">
        <Container className="bg-background mx-auto max-w-xl rounded-xl px-6 py-12 text-foreground">
          <Section>
            <Img
              src="https://placehold.co/1000x200.jpg"
              alt="JARVIS Logo"
              className="mx-auto h-12"
            />
          </Section>
          <Hr className="my-6 border border-border" />
          {children}
        </Container>
      </Body>
    </Tailwind>
  </Html>
);
