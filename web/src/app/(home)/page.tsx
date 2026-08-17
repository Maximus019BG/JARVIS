import HeroSection from "~/components/landing/hero-section"
import FeaturesSection from "~/components/landing/features-section"
import UseCasesSection from "~/components/landing/use-cases-section"
import IntegrationsSection from "~/components/landing/integrations-section"
import CTASection from "~/components/landing/cta-section"

export default function Home() {
  return (
    <main className="min-h-screen">
      <HeroSection />
      <FeaturesSection />
      <UseCasesSection />
      <IntegrationsSection />
      <CTASection />
    </main>
  )
}
