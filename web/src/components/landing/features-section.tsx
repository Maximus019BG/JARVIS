"use client"

import { Camera, Cpu, Zap, Network, Code, Projector } from "lucide-react"
import { useEffect, useRef, useState } from "react"

const features = [
  {
    icon: Camera,
    title: "Contextual Awareness",
    description: "Object recognition, spatial memory, and gesture detection to understand your workspace in real-time.",
  },
  {
    icon: Cpu,
    title: "AI Agent Collaboration",
    description:
      "Seamlessly communicate with ChatGPT, Copilot, HuggingFace, and other AI agents for enhanced productivity.",
  },
  {
    icon: Code,
    title: "Developer Productivity",
    description:
      "Real-time code assistance, automatic documentation, and VS Code integration for streamlined workflows.",
  },
  {
    icon: Projector,
    title: "Projection Overlay",
    description: "Project guides, schematics, and measurements directly onto your workspace for hands-free assistance.",
  },
  {
    icon: Zap,
    title: "Workflow Automation",
    description: "Deep n8n integration for task automation, from code compilation to project management updates.",
  },
  {
    icon: Network,
    title: "IoT Integration",
    description: "Connect with smart devices, sensors, and tools to create an intelligent, responsive workspace.",
  },
]

export default function FeaturesSection() {
  const [visibleCards, setVisibleCards] = useState<number[]>([])
  const sectionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            features.forEach((_, index) => {
              setTimeout(() => {
                setVisibleCards((prev) => [...prev, index])
              }, index * 100)
            })
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
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[oklch(0.5506_0.1038_174.82/0.03)] to-transparent" />

      <div className="relative z-10 container mx-auto px-8 md:px-16 lg:px-24 max-w-7xl">
        <div className="text-center mb-20">
          <h2 className="text-5xl md:text-6xl font-bold mb-6">
            <span className="text-gray-400">Intelligent</span>{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: "linear-gradient(to right, oklch(0.5506 0.1038 174.82), oklch(0.7 0.14 174.82))",
              }}
            >
              Workspace
            </span>
          </h2>
          <p className="text-xl text-gray-500 max-w-2xl mx-auto">
            Combining computer vision, AI collaboration, and hardware integration to revolutionize your workstation.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => {
            const Icon = feature.icon
            const isVisible = visibleCards.includes(index)

            return (
              <div
                key={index}
                className="group relative p-8 rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-sm hover:border-[oklch(0.5506_0.1038_174.82/0.3)] transition-all duration-500 hover:bg-white/[0.04]"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transform: isVisible ? "translateY(0)" : "translateY(30px)",
                  transition: "all 0.6s ease-out",
                }}
              >
                <div
                  className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl"
                  style={{
                    background: "radial-gradient(circle at center, oklch(0.5506 0.1038 174.82 / 0.1), transparent 70%)",
                  }}
                />

                <div className="relative z-10">
                  <div
                    className="w-14 h-14 rounded-xl flex items-center justify-center mb-6 transition-all duration-300 group-hover:scale-110"
                    style={{
                      background: "oklch(0.5506 0.1038 174.82 / 0.1)",
                      border: "1px solid oklch(0.5506 0.1038 174.82 / 0.2)",
                    }}
                  >
                    <Icon className="w-7 h-7" style={{ color: "oklch(0.5506 0.1038 174.82)" }} />
                  </div>

                  <h3 className="text-2xl font-semibold mb-3 text-white">{feature.title}</h3>
                  <p className="text-gray-400 leading-relaxed">{feature.description}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
