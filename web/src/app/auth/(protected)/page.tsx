"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { SignInForm } from "~/components/auth/sign-in-form";
import { SignUpForm } from "~/components/auth/sign-up-form";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

const quotes = [
  {
    text: "The best way to predict the future is to create it.",
    author: "Peter Drucker",
  },
  {
    text: "Innovation distinguishes between a leader and a follower.",
    author: "Steve Jobs",
  },
  {
    text: "The only way to do great work is to love what you do.",
    author: "Steve Jobs",
  },
  {
    text: "Success is not final, failure is not fatal: it is the courage to continue that counts.",
    author: "Winston Churchill",
  },
];

export default function AuthPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const mode = searchParams.get("mode") ?? "sign-in";
  const isSignUp = mode === "sign-up";

  const [currentQuoteIndex, setCurrentQuoteIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentQuoteIndex((prev) => (prev + 1) % quotes.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const currentQuote = quotes[currentQuoteIndex];

  const setMode = (newMode: "sign-in" | "sign-up") => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("mode", newMode);
    router.push(`/auth?${params.toString()}`);
  };

  return (
    <>
      <div className="min-h-dvh min-w-dvw overflow-hidden shadow-2xl">
        <div className="grid min-h-dvh lg:grid-cols-2">
          {/* Sliding overlay */}
          <div
            className={`bg-primary absolute top-0 left-0 z-10 h-full w-1/2 transition-transform duration-700 ease-in-out ${isSignUp ? "translate-x-full" : "translate-x-0"}`}
          >
            <div className="text-primary-foreground flex h-full flex-col items-center justify-center p-12 text-center">
              <div className="max-w-md space-y-8">
                <div className="space-y-6">
                  <div className="bg-primary-foreground/10 mx-auto flex h-24 w-24 items-center justify-center rounded-full backdrop-blur-sm">
                    <svg
                      className="h-12 w-12 animate-pulse"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                      />
                    </svg>
                  </div>
                  <h2 className="text-4xl leading-tight font-bold">
                    {isSignUp ? "Welcome!" : "Welcome Back!"}
                  </h2>
                  <p className="text-lg opacity-90">
                    {isSignUp
                      ? "Start your journey with us today"
                      : "We're glad to see you again"}
                  </p>
                </div>

                <div className="border-primary-foreground/20 space-y-6 border-t pt-8">
                  <blockquote className="text-xl leading-relaxed font-medium italic transition-opacity duration-500">
                    &ldquo;{currentQuote?.text}&rdquo;
                  </blockquote>
                  <p className="text-sm opacity-75">— {currentQuote?.author}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Sign-up form */}
          <div
            className={`bg-card z-20 flex items-center justify-center p-8 transition-all duration-700 lg:p-12 ${isSignUp ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0"} `}
          >
            <div className="w-full max-w-md">
              <Card className="border-0 shadow-none">
                <CardHeader className="space-y-2 text-center">
                  <CardTitle className="text-3xl font-bold">
                    Create your account
                  </CardTitle>
                  <p className="text-muted-foreground text-sm">
                    Enter your details to get started
                  </p>
                </CardHeader>
                <CardContent>
                  <SignUpForm />
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Sign-in form */}
          <div
            className={`bg-card z-20 flex items-center justify-center p-8 transition-all duration-700 lg:p-12 ${isSignUp ? "translate-x-full opacity-0" : "translate-x-0 opacity-100"} `}
          >
            <div className="w-full max-w-md">
              <Card className="border-0 shadow-none">
                <CardHeader className="space-y-2 text-center">
                  <CardTitle className="text-3xl font-bold">
                    Welcome back
                  </CardTitle>
                  <p className="text-muted-foreground text-sm">
                    Sign in to your account to continue
                  </p>
                </CardHeader>
                <CardContent>
                  <SignInForm />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
