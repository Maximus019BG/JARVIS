"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
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

  return (
    <>
      <div className="min-h-dvh min-w-dvw overflow-hidden shadow-2xl">
        <div className="grid min-h-dvh lg:grid-cols-2">
          {/* Sliding overlay - Hidden on mobile */}
          <div
            className={`bg-primary absolute top-0 left-0 z-10 hidden h-full w-1/2 transition-transform duration-700 ease-in-out lg:block ${isSignUp ? "translate-x-full" : "translate-x-0"}`}
          >
            <div className="text-primary-foreground flex h-full flex-col items-center justify-center p-6 text-center lg:p-12">
              <div className="max-w-md space-y-6 lg:space-y-8">
                <div className="space-y-4 lg:space-y-6">
                  <div className="bg-primary-foreground/10 mx-auto flex h-16 w-16 items-center justify-center rounded-full backdrop-blur-sm lg:h-24 lg:w-24">
                    <svg
                      className="h-8 w-8 animate-pulse lg:h-12 lg:w-12"
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
                  <h2 className="text-2xl leading-tight font-bold lg:text-4xl">
                    {isSignUp ? "Welcome!" : "Welcome Back!"}
                  </h2>
                  <p className="text-base opacity-90 lg:text-lg">
                    {isSignUp
                      ? "Start your journey with us today"
                      : "We're glad to see you again"}
                  </p>
                </div>

                <div className="border-primary-foreground/20 space-y-4 border-t pt-6 lg:space-y-6 lg:pt-8">
                  <blockquote className="text-lg leading-relaxed font-medium italic transition-opacity duration-500 lg:text-xl">
                    &ldquo;{currentQuote?.text}&rdquo;
                  </blockquote>
                  <p className="text-sm opacity-75">— {currentQuote?.author}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Sign-up form */}
          <div
            className={`bg-card z-20 flex items-center justify-center p-4 transition-all duration-700 sm:p-6 lg:p-12 ${isSignUp ? "translate-x-0 opacity-100" : "lg:-translate-x-full lg:opacity-0"} ${!isSignUp ? "hidden lg:flex" : ""}`}
          >
            <div className="w-full max-w-md">
              <Card className="border-0 shadow-none">
                <CardHeader className="space-y-2 text-center">
                  <CardTitle className="text-2xl font-bold sm:text-3xl">
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
            className={`bg-card z-20 flex items-center justify-center p-4 transition-all duration-700 sm:p-6 lg:p-12 ${isSignUp ? "lg:translate-x-full lg:opacity-0" : "translate-x-0 opacity-100"} ${isSignUp ? "hidden lg:flex" : ""}`}
          >
            <div className="w-full max-w-md">
              <Card className="border-0 shadow-none">
                <CardHeader className="space-y-2 text-center">
                  <CardTitle className="text-2xl font-bold sm:text-3xl">
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
