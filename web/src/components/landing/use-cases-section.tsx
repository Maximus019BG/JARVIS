"use client";

import { useEffect, useRef, useState } from "react";

const useCases = [
  {
    title: "Electronics Assembly",
    description:
      "Project pinout diagrams and wiring guides directly onto your workbench while assembling circuits.",
    image: "/electronics-workbench-with-circuit-boards.jpg",
  },
  {
    title: "Code Development",
    description:
      "Get real-time code suggestions, debug assistance, and automatic uploads to your microcontrollers.",
    image: "/developer-coding-on-computer-with-raspberry-pi.jpg",
  },
  {
    title: "Component Identification",
    description:
      "Point at any component and instantly see datasheets, specifications, and usage examples.",
    image: "/electronic-components-on-workbench.jpg",
  },
];

export default function UseCasesSection() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
          }
        });
      },
      { threshold: 0.2 },
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden bg-[#0a0a0a] py-32 text-white"
    >
      <div className="relative z-10 container mx-auto max-w-7xl px-8 md:px-16 lg:px-24">
        <div
          className="mb-20 text-center transition-all duration-700"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? "translateY(0)" : "translateY(30px)",
          }}
        >
          <h2 className="mb-6 text-5xl font-bold md:text-6xl">
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(to right, oklch(0.5506 0.1038 174.82), oklch(0.7 0.14 174.82))",
              }}
            >
              See It
            </span>{" "}
            <span className="text-gray-400">In Action</span>
          </h2>
          <p className="mx-auto max-w-2xl text-xl text-gray-500">
            From electronics assembly to software development, JARVIS adapts to
            your workflow.
          </p>
        </div>

        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div
            className="space-y-6 transition-all delay-200 duration-700"
            style={{
              opacity: isVisible ? 1 : 0,
              transform: isVisible ? "translateX(0)" : "translateX(-30px)",
            }}
          >
            {useCases.map((useCase, index) => (
              <div
                key={index}
                onClick={() => setActiveIndex(index)}
                className={`cursor-pointer rounded-xl border p-6 transition-all duration-300 ${
                  activeIndex === index
                    ? "border-[oklch(0.5506_0.1038_174.82/0.5)] bg-white/[0.04]"
                    : "border-white/5 bg-white/[0.02] hover:border-white/10"
                }`}
              >
                <h3 className="mb-2 text-2xl font-semibold text-white">
                  {useCase.title}
                </h3>
                <p className="leading-relaxed text-gray-400">
                  {useCase.description}
                </p>
              </div>
            ))}
          </div>

          <div
            className="relative overflow-hidden rounded-2xl border border-white/10 transition-all delay-400 duration-700"
            style={{
              opacity: isVisible ? 1 : 0,
              transform: isVisible ? "translateX(0)" : "translateX(30px)",
            }}
          >
            <img
              src={
                (useCases[activeIndex] ?? useCases[0])!.image ||
                "/placeholder.svg"
              }
              alt={(useCases[activeIndex] ?? useCases[0])!.title}
              className="h-[500px] w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent to-transparent opacity-60" />
          </div>
        </div>
      </div>
    </section>
  );
}
