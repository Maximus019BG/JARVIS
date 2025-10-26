"use client"

import { useEffect, useRef, useState } from "react"

const integrations = [
  { name: "ChatGPT", logo: "/chatgpt-inspired-abstract.png" },
  { name: "GitHub Copilot", logo: "/github-copilot-logo.png" },
  { name: "n8n", logo: "/n8n-automation-logo.png" },
  { name: "HuggingFace", logo: "/huggingface-logo.png" },
  { name: "Google Workspace", logo: "/google-workspace-logo.png" },
  { name: "VS Code", logo: "/vscode-logo.png" },
]

export default function IntegrationsSection() {
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
      <div className="absolute inset-0 bg-gradient-to-b from-[oklch(0.5506_0.1038_174.82/0.03)] via-transparent to-[oklch(0.5506_0.1038_174.82/0.03)]" />

      <div className="relative z-10 container mx-auto px-8 md:px-16 lg:px-24 max-w-7xl">
        <div
          className="text-center mb-20 transition-all duration-700"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? "translateY(0)" : "translateY(30px)",
          }}
        >
          <h2 className="text-5xl md:text-6xl font-bold mb-6">
            <span className="text-gray-400">Seamless</span>{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: "linear-gradient(to right, oklch(0.5506 0.1038 174.82), oklch(0.7 0.14 174.82))",
              }}
            >
              Integrations
            </span>
          </h2>
          <p className="text-xl text-gray-500 max-w-2xl mx-auto">
            Connect with your favorite tools and AI agents for a unified workflow experience.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8">
          {integrations.map((integration, index) => (
            <div
              key={index}
              className="flex flex-col items-center gap-4 p-6 rounded-xl border border-white/5 bg-white/[0.02] hover:border-[oklch(0.5506_0.1038_174.82/0.3)] hover:bg-white/[0.04] transition-all duration-300 group"
              style={{
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? "scale(1)" : "scale(0.9)",
                transition: `all 0.5s ease-out ${index * 0.1}s`,
              }}
            >
              <div className="w-20 h-20 rounded-xl bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <img
                  src={integration.logo || "/placeholder.svg"}
                  alt={integration.name}
                  className="w-12 h-12 object-contain"
                />
              </div>
              <span className="text-sm text-gray-400 text-center">{integration.name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
