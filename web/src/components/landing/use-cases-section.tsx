"use client"

import { useEffect, useRef, useState } from "react"

const useCases = [
  {
    title: "Electronics Assembly",
    description: "Project pinout diagrams and wiring guides directly onto your workbench while assembling circuits.",
    image: "/electronics-workbench-with-circuit-boards.jpg",
  },
  {
    title: "Code Development",
    description: "Get real-time code suggestions, debug assistance, and automatic uploads to your microcontrollers.",
    image: "/developer-coding-on-computer-with-raspberry-pi.jpg",
  },
  {
    title: "Component Identification",
    description: "Point at any component and instantly see datasheets, specifications, and usage examples.",
    image: "/electronic-components-on-workbench.jpg",
  },
]

export default function UseCasesSection() {
  const [activeIndex, setActiveIndex] = useState(0)
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
      <div className="relative z-10 container mx-auto px-8 md:px-16 lg:px-24 max-w-7xl">
        <div
          className="text-center mb-20 transition-all duration-700"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? "translateY(0)" : "translateY(30px)",
          }}
        >
          <h2 className="text-5xl md:text-6xl font-bold mb-6">
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: "linear-gradient(to right, oklch(0.5506 0.1038 174.82), oklch(0.7 0.14 174.82))",
              }}
            >
              See It
            </span>{" "}
            <span className="text-gray-400">In Action</span>
          </h2>
          <p className="text-xl text-gray-500 max-w-2xl mx-auto">
            From electronics assembly to software development, JARVIS adapts to your workflow.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div
            className="space-y-6 transition-all duration-700 delay-200"
            style={{
              opacity: isVisible ? 1 : 0,
              transform: isVisible ? "translateX(0)" : "translateX(-30px)",
            }}
          >
            {useCases.map((useCase, index) => (
              <div
                key={index}
                onClick={() => setActiveIndex(index)}
                className={`p-6 rounded-xl border cursor-pointer transition-all duration-300 ${
                  activeIndex === index
                    ? "border-[oklch(0.5506_0.1038_174.82/0.5)] bg-white/[0.04]"
                    : "border-white/5 bg-white/[0.02] hover:border-white/10"
                }`}
              >
                <h3 className="text-2xl font-semibold mb-2 text-white">{useCase.title}</h3>
                <p className="text-gray-400 leading-relaxed">{useCase.description}</p>
              </div>
            ))}
          </div>

          <div
            className="relative rounded-2xl overflow-hidden border border-white/10 transition-all duration-700 delay-400"
            style={{
              opacity: isVisible ? 1 : 0,
              transform: isVisible ? "translateX(0)" : "translateX(30px)",
            }}
          >
            <img
              src={useCases[activeIndex].image || "/placeholder.svg"}
              alt={useCases[activeIndex].title}
              className="w-full h-[500px] object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent to-transparent opacity-60" />
          </div>
        </div>
      </div>
    </section>
  )
}
