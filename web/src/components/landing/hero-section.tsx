"use client"

import { Button } from "~/components/ui/button"
import { ArrowRight } from "lucide-react"
import { useEffect, useState } from "react"

export default function HeroSection() {
  const [mounted, setMounted] = useState(false)
  const [displayedText, setDisplayedText] = useState("")
  const [displayedSubtext, setDisplayedSubtext] = useState("")
  const fullText = "JARVIS"
  const fullSubtext = "Job Acceleration Reference Visual Interface System"

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    let currentIndex = 0
    const interval = setInterval(() => {
      if (currentIndex <= fullText.length) {
        setDisplayedText(fullText.slice(0, currentIndex))
        currentIndex++
      } else {
        clearInterval(interval)
      }
    }, 150)

    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const timeout = setTimeout(() => {
      let currentIndex = 0
      const interval = setInterval(() => {
        if (currentIndex <= fullSubtext.length) {
          setDisplayedSubtext(fullSubtext.slice(0, currentIndex))
          currentIndex++
        } else {
          clearInterval(interval)
        }
      }, 30)

      return () => clearInterval(interval)
    }, 1000)

    return () => clearTimeout(timeout)
  }, [])

  return (
    <section className="relative min-h-screen bg-[#0a0a0a] text-white flex items-center overflow-hidden">
      <div className="absolute inset-0">
        <div
          className="absolute left-[20%] top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-white/5 to-transparent transition-opacity duration-500 delay-50"
          style={{ opacity: mounted ? 1 : 0 }}
        />
        <div
          className="absolute left-[40%] top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-white/3 to-transparent transition-opacity duration-500 delay-100"
          style={{ opacity: mounted ? 1 : 0 }}
        />
        <div
          className="absolute right-[30%] top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-white/5 to-transparent transition-opacity duration-500 delay-150"
          style={{ opacity: mounted ? 1 : 0 }}
        />
        <div
          className="absolute left-0 right-0 top-[30%] h-px bg-gradient-to-r from-transparent via-white/5 to-transparent transition-opacity duration-500 delay-75"
          style={{ opacity: mounted ? 1 : 0 }}
        />
        <div
          className="absolute left-0 right-0 top-[60%] h-px bg-gradient-to-r from-transparent via-white/3 to-transparent transition-opacity duration-500 delay-125"
          style={{ opacity: mounted ? 1 : 0 }}
        />
      </div>

      <div
        className="absolute top-1/2 left-[20%] -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full blur-[120px] opacity-15 transition-all duration-800"
        style={{
          background: "oklch(0.5506 0.1038 174.82)",
          transform: mounted ? "translate(-50%, -50%) scale(1)" : "translate(-50%, -50%) scale(0.8)",
          opacity: mounted ? 0.15 : 0,
        }}
      />

      <div className="relative z-10 container mx-auto px-8 md:px-16 lg:px-24 max-w-7xl">
        <div
          className="max-w-3xl space-y-8 transition-all duration-600"
          style={{
            transform: mounted ? "translateY(0)" : "translateY(30px)",
            opacity: mounted ? 1 : 0,
          }}
        >
          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 text-sm font-medium text-gray-400 bg-white/5 backdrop-blur-sm transition-all duration-400 delay-100"
            style={{
              transform: mounted ? "translateY(0)" : "translateY(20px)",
              opacity: mounted ? 1 : 0,
            }}
          >
            Powered by Raspberry Pi 5
          </div>

          <h1
            className="text-7xl md:text-8xl lg:text-9xl font-bold tracking-tight transition-all duration-600 delay-150"
            style={{
              transform: mounted ? "translateX(0)" : "translateX(-30px)",
              opacity: mounted ? 1 : 0,
            }}
          >
            <span
              className="bg-clip-text text-transparent inline-block"
              style={{
                backgroundImage: "linear-gradient(to right, oklch(0.5506 0.1038 174.82), oklch(0.7 0.14 174.82))",
              }}
            >
              {displayedText}
              {displayedText.length < fullText.length && <span className="animate-pulse">|</span>}
            </span>
          </h1>

          <p
            className="text-xl md:text-2xl text-gray-400 font-light leading-relaxed min-h-[2em] transition-all duration-600 delay-250"
            style={{
              opacity: mounted ? 1 : 0,
            }}
          >
            {displayedSubtext}
            {displayedSubtext.length > 0 && displayedSubtext.length < fullSubtext.length && (
              <span className="animate-pulse">|</span>
            )}
          </p>

          <p
            className="text-base md:text-lg text-gray-500 max-w-xl leading-relaxed transition-all duration-600 delay-350"
            style={{
              opacity: displayedSubtext.length === fullSubtext.length && mounted ? 1 : 0,
              transform: mounted ? "translateY(0)" : "translateY(20px)",
            }}
          >
            Your intelligent workstation assistant combining computer vision, projection mapping, and AI collaboration.
          </p>

          <div className="flex flex-wrap gap-4 pt-4">
            <Button
              size="lg"
              className="text-black font-semibold px-8 hover:opacity-90 transition-all duration-600 delay-450 hover:scale-105"
              style={{
                background: "oklch(0.5506 0.1038 174.82)",
                opacity: displayedSubtext.length === fullSubtext.length && mounted ? 1 : 0,
                transform: mounted ? "translateY(0)" : "translateY(20px)",
              }}
            >
              Get Started
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="font-semibold px-8 bg-transparent hover:bg-white/5 transition-all duration-600 delay-500 border-white/10 text-gray-300 hover:scale-105"
              style={{
                opacity: displayedSubtext.length === fullSubtext.length && mounted ? 1 : 0,
                transform: mounted ? "translateY(0)" : "translateY(20px)",
              }}
            >
              Watch Demo
            </Button>
          </div>
        </div>
      </div>

      <div className="absolute right-[10%] top-1/2 -translate-y-1/2 w-[400px] h-[400px] opacity-30">
        <div
          className="absolute top-0 right-0 w-32 h-32 rounded-full border border-white/10 transition-all duration-600 delay-250"
          style={{
            animation: mounted ? "float 8s ease-in-out infinite" : "none",
            opacity: mounted ? 1 : 0,
            transform: mounted ? "scale(1)" : "scale(0.5)",
          }}
        />
        <div
          className="absolute bottom-0 right-20 w-24 h-24 rounded-full border border-white/5 transition-all duration-600 delay-350"
          style={{
            animation: mounted ? "float 6s ease-in-out infinite 1s" : "none",
            opacity: mounted ? 1 : 0,
            transform: mounted ? "scale(1)" : "scale(0.5)",
          }}
        />
        <div
          className="absolute top-1/2 right-10 w-16 h-16 rounded-full border transition-all duration-600 delay-450"
          style={{
            borderColor: "oklch(0.5506 0.1038 174.82 / 0.2)",
            animation: mounted ? "float 10s ease-in-out infinite 2s" : "none",
            opacity: mounted ? 1 : 0,
            transform: mounted ? "scale(1)" : "scale(0.5)",
          }}
        />
      </div>

      <style jsx>{`
        @keyframes float {
          0%, 100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-20px);
          }
        }
      `}</style>
    </section>
  )
}
