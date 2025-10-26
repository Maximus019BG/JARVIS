"use client"

import { Button } from "~/components/ui/button"
import { ArrowRight, Github } from "lucide-react"
import { useEffect, useRef, useState } from "react"

export default function CTASection() {
  const [isVisible, setIsVisible] = useState(false)
  const sectionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true)
            observer.disconnect()
          }
        })
      },
      { threshold: 0.2 },
    )

    if (sectionRef.current) {
      observer.observe(sectionRef.current)
    }

    return () => observer.disconnect()
  }, [])

  return (
    <section ref={sectionRef} className="relative bg-[#0a0a0a] text-white py-32 overflow-hidden">
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: "radial-gradient(circle at 50% 50%, oklch(0.5506 0.1038 174.82 / 0.15), transparent 50%)",
        }}
      />

      <div className="relative z-10 container mx-auto px-8 md:px-16 lg:px-24 max-w-4xl text-center">
        <div
          className="transition-all duration-700"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? "translateY(0)" : "translateY(30px)",
          }}
        >
          <h2 className="text-5xl md:text-6xl font-bold mb-6">
            <span className="text-gray-400">Ready to Transform</span>
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: "linear-gradient(to right, oklch(0.5506 0.1038 174.82), oklch(0.7 0.14 174.82))",
              }}
            >
              Your Workspace?
            </span>
          </h2>
          <p className="text-xl text-gray-500 mb-12 max-w-2xl mx-auto">
            Join the future of intelligent workstations. Get started with JARVIS today.
          </p>

          <div className="flex flex-wrap gap-4 justify-center">
            <Button
              size="lg"
              className="text-black font-semibold px-8 hover:opacity-90 hover:scale-105 transition-all"
              style={{
                background: "oklch(0.5506 0.1038 174.82)",
              }}
            >
              Get Started
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="font-semibold px-8 bg-transparent hover:bg-white/5 border-white/10 text-gray-300 hover:scale-105 transition-all"
            >
              <Github className="mr-2 w-5 h-5" />
              View on GitHub
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
