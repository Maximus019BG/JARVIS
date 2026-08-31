"use client";

import React from "react";

/**
 * Last-resort boundary. Replaces the root layout, so it renders its own document and
 * deliberately uses inline styles rather than Tailwind classes — if the failure that got us
 * here was the stylesheet, a class-based page would render as unstyled text.
 *
 * Its whole job is to say what broke. Next's builtin equivalent reports neither the message
 * nor the digest, which is what made this class of crash unfixable from a bug report.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("Unhandled application error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          background: "#0a0a0a",
          color: "#fafafa",
        }}
      >
        <div style={{ maxWidth: "40rem", textAlign: "center" }}>
          <h1
            style={{
              fontSize: "1.125rem",
              fontWeight: 600,
              margin: "0 0 0.5rem",
            }}
          >
            Something went wrong.
          </h1>
          <p
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: "0.75rem",
              lineHeight: 1.6,
              color: "#a3a3a3",
              overflowWrap: "break-word",
              margin: "0 0 0.25rem",
            }}
          >
            {error.message || error.name || "Unknown error"}
          </p>
          {error.digest && (
            <p
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: "0.6875rem",
                color: "#737373",
                margin: "0 0 1.25rem",
              }}
            >
              digest {error.digest}
            </p>
          )}
          <div
            style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                cursor: "pointer",
                borderRadius: "0.375rem",
                border: "1px solid #fafafa",
                background: "#fafafa",
                color: "#0a0a0a",
                padding: "0.5rem 0.875rem",
                fontSize: "0.875rem",
              }}
            >
              Try again
            </button>
            <a
              href="/app"
              style={{
                borderRadius: "0.375rem",
                border: "1px solid #404040",
                color: "#fafafa",
                padding: "0.5rem 0.875rem",
                fontSize: "0.875rem",
                textDecoration: "none",
              }}
            >
              Go to dashboard
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
