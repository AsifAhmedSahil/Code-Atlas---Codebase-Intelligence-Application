import { AskGrounded } from "@/components/landing/ask-grounded";
import { Boundaries } from "@/components/landing/boundaries";
import { Capabilities } from "@/components/landing/capabilities";
import { FinalCta } from "@/components/landing/final-cta";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { MarketingFooter } from "@/components/landing/marketing-footer";
import { MarketingNav } from "@/components/landing/marketing-nav";
import { ProductPreview } from "@/components/landing/product-preview";
import { UseCases } from "@/components/landing/use-cases";

/*
 * The landing page, composed as an editorial narrative: a hero that carries the
 * product, the workspace as the proof, then the process, the capabilities, one
 * worked example of the assistant, the honest boundaries, the use cases, and a
 * closing action. Each section is its own file so the page reads as a table of
 * contents.
 */
export default function LandingPage() {
  return (
    <>
      <MarketingNav />
      <main id="main">
        <Hero />

        <section className="mx-auto w-full max-w-6xl px-6 pb-24 sm:pb-32">
          <ProductPreview />
        </section>

        <HowItWorks />
        <Capabilities />
        <AskGrounded />
        <Boundaries />
        <UseCases />
        <FinalCta />
      </main>
      <MarketingFooter />
    </>
  );
}
