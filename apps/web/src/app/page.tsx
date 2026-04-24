import type { ReactNode } from "react";
import Link from "next/link";

import { LandingNavbar } from "@/components/layout/landing-navbar";
import { buttonClassName } from "@/components/ui/button";
import { cardSurfaceClassName } from "@/components/ui/card";
import { cn } from "@/lib/cn";

export default function HomePage() {
  return (
    <main className="relative min-h-dvh overflow-x-hidden bg-zinc-950 text-zinc-100">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_55%_at_50%_0%,rgba(34,211,238,0.16)_0%,rgba(2,6,23,0)_65%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(circle_at_center,black,transparent_82%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-28 top-24 h-72 w-72 rounded-full bg-cyan-300/15 blur-[110px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 top-48 h-72 w-72 rounded-full bg-cyan-500/12 blur-[120px]"
      />

      <LandingNavbar />

      <section className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-8 sm:gap-16 sm:px-6 sm:py-12 lg:px-8 lg:py-16">
        <header className="space-y-7 text-center lg:space-y-8 lg:text-left">
          <div className="max-w-4xl space-y-5">
            <h1 className="text-balance text-[1.95rem] font-semibold tracking-[-0.02em] text-white sm:text-5xl lg:text-[3.65rem] lg:leading-[1.03]">
              Milestone escrow for Web3 teams that want trust, speed, and certainty.
            </h1>
            <p className="mx-auto max-w-3xl text-pretty text-sm leading-relaxed text-zinc-300 sm:text-base lg:mx-0 lg:text-[1.08rem] lg:leading-relaxed">
              Fund once, release by milestone, and keep every delivery verifiable with on-chain
              payments plus IPFS-backed work artifacts. Built for premium freelancer and client
              workflows.
            </p>
          </div>

        </header>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Escrow safety" value="On-chain enforced" />
          <StatTile label="Proof of delivery" value="IPFS artifacts" />
          <StatTile label="Payout control" value="Milestone by milestone" />
          <StatTile label="Dispute readiness" value="Structured resolution" />
        </section>

        <SectionBlock
          title="Feature highlights"
          subtitle="A premium execution layer for milestone contracts, visibility, and payout confidence."
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[
              {
                title: "Secure milestone funding",
                description:
                  "Clients lock project value in escrow and release milestone payouts with clear state transitions.",
              },
              {
                title: "Immutable work proofs",
                description:
                  "Deliverables, metadata, and evidence are tracked through IPFS references for transparent history.",
              },
              {
                title: "Real-time status clarity",
                description:
                  "Funding, submissions, reviews, and disputes stay synchronized across dashboard and project views.",
              },
              {
                title: "Role-aware workflows",
                description:
                  "Client and freelancer experiences are tailored for approvals, submissions, and payout actions.",
              },
              {
                title: "Production-grade dispute flow",
                description:
                  "Escalate, review, and resolve conflicts with a complete audit trail and controlled release paths.",
              },
              {
                title: "Web3-native sign-in",
                description:
                  "SIWE wallet authentication keeps onboarding seamless while preserving security and user control.",
              },
            ].map((feature) => (
              <FeatureCard
                key={feature.title}
                title={feature.title}
                description={feature.description}
              />
            ))}
          </div>
        </SectionBlock>

        <SectionBlock
          title="How it works"
          subtitle="A clear, frictionless lifecycle from kickoff to payout."
        >
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
            {[
              ["1. Create", "Set milestones, terms, and funding context."],
              ["2. Fund", "Lock escrow to activate trust before delivery."],
              ["3. Deliver", "Freelancer submits milestone evidence and notes."],
              ["4. Release", "Approve work and release milestone payouts."],
            ].map(([step, text]) => (
              <div
                key={step}
                className={cn(cardSurfaceClassName, "flex flex-col gap-2 p-4 sm:p-5")}
              >
                <p className="text-sm font-semibold tracking-wide text-cyan-200">{step}</p>
                <p className="text-sm leading-relaxed text-zinc-300">{text}</p>
              </div>
            ))}
          </div>
        </SectionBlock>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SectionBlock
            title="Why milestone escrow"
            subtitle="Reduce payment risk and remove ambiguity in project execution."
          >
            <ul className="space-y-3 text-sm leading-relaxed text-zinc-300">
              <li>• Funds are committed upfront, so both parties align on execution confidence.</li>
              <li>• Payouts map directly to delivered outcomes instead of vague project stages.</li>
              <li>• Every state change is traceable, reducing disputes and negotiation overhead.</li>
            </ul>
          </SectionBlock>

          <SectionBlock
            title="Trust, security, and value"
            subtitle="Enterprise-grade clarity with startup-friendly speed."
          >
            <ul className="space-y-3 text-sm leading-relaxed text-zinc-300">
              <li>• Wallet-native auth and contract interactions keep custody assumptions explicit.</li>
              <li>• IPFS-linked submissions preserve deliverable integrity and review transparency.</li>
              <li>• Unified event and notification stream keeps teams aligned without manual chasing.</li>
            </ul>
          </SectionBlock>
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SectionBlock
            title="For clients"
            subtitle="Control risk, streamline approvals, and ship with confidence."
          >
            <ul className="space-y-2.5 text-sm text-zinc-300">
              <li>• Structured milestone approvals and payout controls</li>
              <li>• Complete audit trail for every release decision</li>
              <li>• Cleaner collaboration with less payment friction</li>
            </ul>
          </SectionBlock>

          <SectionBlock
            title="For freelancers"
            subtitle="Get paid fairly for verified progress."
          >
            <ul className="space-y-2.5 text-sm text-zinc-300">
              <li>• Clear payout milestones and delivery expectations</li>
              <li>• Transparent submission and review lifecycle</li>
              <li>• Faster trust-building with premium clients</li>
            </ul>
          </SectionBlock>
        </section>

        <section
          className={cn(
            cardSurfaceClassName,
            "relative overflow-hidden p-5 sm:p-8 lg:p-10",
          )}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_80%_at_20%_20%,rgba(34,211,238,0.18)_0%,rgba(34,211,238,0)_70%)]"
          />
          <div className="relative z-10 flex flex-col gap-5">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">
                Ready to upgrade escrow operations?
              </p>
              <h2 className="text-balance text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Launch premium milestone contracts in minutes.
              </h2>
              <p className="max-w-2xl text-sm leading-relaxed text-zinc-300 sm:text-base">
                Start with wallet sign-in, complete onboarding, and move from project setup to
                secure release flows with full visibility.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link
                href="/login"
                className={buttonClassName({
                  variant: "primary",
                  size: "lg",
                  className: "w-full sm:w-auto",
                })}
              >
                Get started
              </Link>
              <Link
                href="/dashboard"
                className={buttonClassName({
                  variant: "secondary",
                  size: "lg",
                  className: "w-full sm:w-auto",
                })}
              >
                View product
              </Link>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn(cardSurfaceClassName, "p-4 sm:p-5", "hover:-translate-y-0.5 hover:border-zinc-700/90")}>
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-400">{label}</p>
      <p className="mt-2 text-base font-semibold text-zinc-100 sm:text-lg">{value}</p>
    </div>
  );
}

function SectionBlock({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-balance text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {title}
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-300 sm:text-base">{subtitle}</p>
      </div>
      <div className="h-px w-full bg-gradient-to-r from-transparent via-cyan-300/25 to-transparent" />
      {children}
    </div>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div
      className={cn(
        cardSurfaceClassName,
        "flex flex-col gap-2 p-4 sm:p-5",
        "hover:-translate-y-0.5 hover:border-zinc-700/90 hover:shadow-[0_20px_40px_-24px_rgba(0,0,0,0.95),0_0_0_1px_rgba(34,211,238,0.1)]",
      )}
    >
      <p className="text-base font-semibold tracking-tight text-zinc-100">{title}</p>
      <p className="text-sm leading-relaxed text-zinc-300">{description}</p>
    </div>
  );
}
