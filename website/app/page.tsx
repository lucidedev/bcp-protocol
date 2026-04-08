"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useInView } from "framer-motion";
import {
  MessageSquare,
  FileText,
  ArrowLeftRight,
  Shield,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Copy,
  Check,
  ExternalLink,
  Zap,
  Lock,
  Handshake,
  ChevronRight,
  Building2,
  Bot,
} from "lucide-react";

function GithubIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

// ─── Nav ────────────────────────────────────────────────────────────────────

function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-white/80 backdrop-blur-xl border-b border-zinc-200"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-[#4D65FF] text-white font-bold text-xs">
            B
          </div>
          <span className="font-semibold text-zinc-900 text-sm tracking-tight">
            BCP
          </span>
          <span className="hidden sm:inline text-zinc-400 text-sm">
            Business Commerce Protocol
          </span>
        </div>

        <a
          href="https://github.com/lucidedev/bcp-protocol"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
        >
          <GithubIcon size={15} />
          <span className="hidden sm:inline">GitHub</span>
        </a>
      </div>
    </nav>
  );
}

// ─── Shared ─────────────────────────────────────────────────────────────────

function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <motion.section
      id={id}
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className={`py-20 sm:py-28 px-6 ${className}`}
    >
      {children}
    </motion.section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-1.5 text-[#4D65FF] text-xs font-semibold tracking-widest uppercase mb-4">
      {children}
    </div>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

const STATES = ["intent", "quoted", "countered", "committed", "fulfilled"];

function Hero() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const i = setInterval(() => setActive((p) => (p + 1) % STATES.length), 1400);
    return () => clearInterval(i);
  }, []);

  return (
    <section className="relative min-h-[90vh] flex flex-col items-center justify-center pt-14 hero-gradient">
      <div className="relative z-10 max-w-3xl mx-auto px-6 text-center">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="inline-flex items-center gap-2 border border-zinc-200 bg-white rounded-full px-3.5 py-1 text-xs text-zinc-500 mb-8 font-medium shadow-sm"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Open Source · Apache 2.0 · v0.2
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] text-zinc-900 mb-5"
        >
          The open protocol for
          <br />
          <span className="text-[#4D65FF]">AI agent commerce</span>
        </motion.h1>

        {/* Sub */}
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="text-lg text-zinc-500 max-w-xl mx-auto mb-10 leading-relaxed"
        >
          BCP defines how AI agents negotiate and settle B2B
          deals&nbsp;— lean messages, pluggable settlement, works in minutes.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-8"
        >
          <a
            href="#demo"
            className="inline-flex items-center gap-2 bg-[#4D65FF] hover:bg-[#3b53ed] text-white font-medium px-5 py-2.5 rounded-lg transition-all text-sm shadow-sm"
          >
            See how it works
            <ArrowRight size={14} />
          </a>
          <a
            href="#quickstart"
            className="inline-flex items-center gap-2 border border-zinc-200 hover:border-zinc-300 bg-white text-zinc-700 font-medium px-5 py-2.5 rounded-lg transition-all text-sm shadow-sm"
          >
            Quick start
            <ChevronRight size={14} />
          </a>
        </motion.div>

        {/* Install command */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="inline-flex items-center gap-3 bg-zinc-900 rounded-lg px-5 py-2.5 font-mono text-sm shadow-sm mb-10"
        >
          <span className="text-zinc-500 select-none">$</span>
          <span className="text-zinc-300">npm install</span>
          <span className="text-[#4D65FF] font-medium">@bcp-protocol/sdk</span>
          <button
            onClick={() =>
              navigator.clipboard.writeText("npm install @bcp-protocol/sdk")
            }
            className="ml-1 text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            <Copy size={13} />
          </button>
        </motion.div>

        {/* Animated state machine */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="flex items-center justify-center gap-0 py-2 overflow-x-auto"
        >
          {STATES.map((s, i) => (
            <div key={s} className="flex items-center">
              <div
                className={`px-3 py-1.5 rounded-md border text-[11px] font-mono font-semibold tracking-wider transition-all duration-300 ${
                  i === active
                    ? "border-[#4D65FF]/40 bg-[#4D65FF]/5 text-[#4D65FF] shadow-sm"
                    : i < active
                    ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                    : "border-zinc-200 bg-zinc-50 text-zinc-400"
                }`}
              >
                {s}
              </div>
              {i < STATES.length - 1 && (
                <div className="w-6 flex items-center justify-center">
                  <div
                    className={`h-px w-full transition-colors duration-300 ${
                      i < active ? "bg-emerald-300" : "bg-zinc-200"
                    }`}
                  />
                </div>
              )}
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ─── Demo Flow Mockup ─────────────────────────────────────────────────────────

interface DemoMessage {
  type: string;
  from: "buyer" | "seller" | "chain";
  label: string;
  detail: string;
  color: string;
}

const DEMO_MESSAGES: DemoMessage[] = [
  {
    type: "intent",
    from: "buyer",
    label: "Intent",
    detail: "Logo design · budget ≤ $500",
    color: "#4D65FF",
  },
  {
    type: "quote",
    from: "seller",
    label: "Quote",
    detail: "$450 · 5 business days",
    color: "#7c8fff",
  },
  {
    type: "counter",
    from: "buyer",
    label: "Counter",
    detail: "$350 · budget is tight",
    color: "#f59e0b",
  },
  {
    type: "quote",
    from: "seller",
    label: "Revised Quote",
    detail: "$400 · 5 business days",
    color: "#7c8fff",
  },
  {
    type: "commit",
    from: "buyer",
    label: "Commit",
    detail: "$400 agreed · settlement: invoice",
    color: "#22c55e",
  },
  {
    type: "fulfil",
    from: "seller",
    label: "Fulfil",
    detail: "3 logo concepts delivered",
    color: "#10b981",
  },
];

function DemoFlow() {
  const [visibleCount, setVisibleCount] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  useEffect(() => {
    if (inView && !isRunning) {
      setIsRunning(true);
      setVisibleCount(0);
    }
  }, [inView, isRunning]);

  useEffect(() => {
    if (!isRunning) return;
    if (visibleCount >= DEMO_MESSAGES.length) {
      const t = setTimeout(() => {
        setVisibleCount(0);
        setTimeout(() => setIsRunning(true), 300);
      }, 3000);
      return () => clearTimeout(t);
    }
    const t = setTimeout(
      () => setVisibleCount((c) => c + 1),
      visibleCount === 0 ? 400 : 900
    );
    return () => clearTimeout(t);
  }, [visibleCount, isRunning]);

  return (
    <Section id="demo" className="max-w-5xl mx-auto">
      <div className="text-center mb-14">
        <SectionLabel>Live Demo Flow</SectionLabel>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 mb-3">
          Watch two agents negotiate a deal
        </h2>
        <p className="text-zinc-500 max-w-lg mx-auto">
          A complete procurement cycle — from intent to settlement — in six
          signed messages.
        </p>
      </div>

      <div ref={ref} className="relative max-w-2xl mx-auto">
        {/* Agent headers */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center">
              <Building2 size={16} className="text-[#4D65FF]" />
            </div>
            <div>
              <div className="text-sm font-semibold text-zinc-900">
                Acme Corp
              </div>
              <div className="text-[11px] text-zinc-400 font-medium">
                Buyer Agent
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="text-right">
              <div className="text-sm font-semibold text-zinc-900">
                Widgets Inc
              </div>
              <div className="text-[11px] text-zinc-400 font-medium">
                Seller Agent
              </div>
            </div>
            <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center">
              <Bot size={16} className="text-emerald-600" />
            </div>
          </div>
        </div>

        {/* Messages container */}
        <div className="relative border border-zinc-200 rounded-xl bg-zinc-50/50 p-5 min-h-[380px]">
          {/* Center line */}
          <div className="absolute left-1/2 top-5 bottom-5 w-px bg-zinc-100 -translate-x-1/2" />

          <div className="space-y-3 relative">
            <AnimatePresence>
              {DEMO_MESSAGES.slice(0, visibleCount).map((msg, i) => (
                <motion.div
                  key={`${msg.type}-${i}`}
                  initial={{
                    opacity: 0,
                    x: msg.from === "buyer" ? -24 : 24,
                    y: 8,
                  }}
                  animate={{ opacity: 1, x: 0, y: 0 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className={`flex ${
                    msg.from === "seller" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[260px] rounded-xl px-4 py-3 border shadow-sm ${
                      msg.from === "buyer"
                        ? "bg-white border-zinc-200 rounded-bl-md"
                        : "bg-white border-zinc-200 rounded-br-md"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <div
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: msg.color }}
                      />
                      <span
                        className="text-[11px] font-mono font-semibold tracking-wider uppercase"
                        style={{ color: msg.color }}
                      >
                        {msg.type}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-zinc-800">
                      {msg.label}
                    </div>
                    <div className="text-xs text-zinc-400 mt-0.5">
                      {msg.detail}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Completion state */}
            <AnimatePresence>
              {visibleCount >= DEMO_MESSAGES.length && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4, delay: 0.2 }}
                  className="flex justify-center pt-2"
                >
                  <div className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium rounded-full px-4 py-1.5">
                    <CheckCircle2 size={13} />
                    Deal complete · $400 settled
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Bottom detail */}
        <div className="flex items-center justify-center gap-4 mt-4 text-[11px] text-zinc-400 font-mono">
          <span>6 messages</span>
          <span className="w-1 h-1 rounded-full bg-zinc-300" />
          <span>optional auth</span>
          <span className="w-1 h-1 rounded-full bg-zinc-300" />
          <span>pluggable settlement</span>
        </div>
      </div>
    </Section>
  );
}

// ─── Problem ──────────────────────────────────────────────────────────────────

const problems = [
  {
    icon: <Zap size={18} />,
    title: "No Negotiation",
    description:
      "x402 is fixed-price. Agents can't counter-offer. B2B commerce requires dynamic pricing and iterative agreement.",
  },
  {
    icon: <Lock size={18} />,
    title: "No Escrow",
    description:
      "Nothing guarantees delivery-before-payment. Agents need trustless settlement that protects both parties.",
  },
  {
    icon: <Handshake size={18} />,
    title: "No B2B Standard",
    description:
      "Every team reinvents procurement logic. There's no open protocol for machine-to-machine business.",
  },
];

function ProblemSection() {
  return (
    <Section className="max-w-5xl mx-auto">
      <div className="text-center mb-14">
        <SectionLabel>The Problem</SectionLabel>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 mb-3">
          Agents can pay. They can&rsquo;t do business.
        </h2>
        <p className="text-zinc-500 max-w-lg mx-auto">
          x402 solved HTTP payments. But commerce is more than a single payment.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {problems.map((p, i) => (
          <motion.div
            key={p.title}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: i * 0.1 }}
            className="bg-white border border-zinc-200 rounded-xl p-6 card-hover"
          >
            <div className="w-9 h-9 rounded-lg bg-zinc-50 border border-zinc-200 flex items-center justify-center text-[#4D65FF] mb-4">
              {p.icon}
            </div>
            <h3 className="font-semibold text-zinc-900 text-[15px] mb-2">
              {p.title}
            </h3>
            <p className="text-zinc-500 text-sm leading-relaxed">
              {p.description}
            </p>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

// ─── Protocol Messages ────────────────────────────────────────────────────────

const messages = [
  {
    name: "INTENT",
    color: "#4D65FF",
    icon: <MessageSquare size={16} />,
    description: "Buyer describes what they need. Just a service description and optional budget.",
    role: "Buyer → Seller",
  },
  {
    name: "QUOTE",
    color: "#7c8fff",
    icon: <FileText size={16} />,
    description: "Seller responds with price, deliverables, and optional settlement method.",
    role: "Seller → Buyer",
  },
  {
    name: "COUNTER",
    color: "#f59e0b",
    icon: <ArrowLeftRight size={16} />,
    description: "Either party proposes a different price with an optional reason.",
    role: "Buyer ↔ Seller",
  },
  {
    name: "COMMIT",
    color: "#22c55e",
    icon: <Shield size={16} />,
    description: "Buyer accepts. Settlement is pluggable — invoice, x402, escrow, or none.",
    role: "Buyer → Chain",
  },
  {
    name: "FULFIL",
    color: "#10b981",
    icon: <CheckCircle2 size={16} />,
    description: "Seller delivers. Optional proof hash and invoice URL.",
    role: "Seller → Chain",
  },
  {
    name: "DISPUTE",
    color: "#ef4444",
    icon: <AlertTriangle size={16} />,
    description: "Either party flags a problem with a reason and resolution preference.",
    role: "Buyer ↔ Seller",
  },
];

function ProtocolSection() {
  return (
    <Section className="max-w-5xl mx-auto">
      <div className="text-center mb-14">
        <SectionLabel>The Protocol</SectionLabel>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 mb-3">
          Six messages. Complete commerce.
        </h2>
        <p className="text-zinc-500 max-w-lg mx-auto">
          Every B2B transaction maps to exactly these six message types.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {messages.map((msg, i) => (
          <motion.div
            key={msg.name}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: i * 0.06 }}
            className="bg-white border border-zinc-200 rounded-xl p-5 card-hover"
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center mb-3"
              style={{
                backgroundColor: msg.color + "10",
                border: `1px solid ${msg.color}25`,
                color: msg.color,
              }}
            >
              {msg.icon}
            </div>
            <div className="flex items-baseline gap-2 mb-1.5">
              <span
                className="font-mono text-xs font-bold tracking-wider"
                style={{ color: msg.color }}
              >
                {msg.name}
              </span>
              <span className="text-zinc-300 text-[10px] font-mono">
                {msg.role}
              </span>
            </div>
            <p className="text-zinc-500 text-sm leading-relaxed">
              {msg.description}
            </p>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

// ─── Architecture ─────────────────────────────────────────────────────────────

function ArchitectureSection() {
  return (
    <Section className="max-w-5xl mx-auto">
      <div className="text-center mb-14">
        <SectionLabel>Architecture</SectionLabel>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 mb-3">
          Pluggable settlement
        </h2>
        <p className="text-zinc-500 max-w-lg mx-auto">
          Start with no settlement. Add invoicing, x402 payments, or on-chain escrow when you need it.
        </p>
      </div>

      <div className="max-w-2xl mx-auto space-y-6">
        {/* Layer stack */}
        <div className="space-y-3">
          <div className="border border-[#4D65FF]/20 bg-[#4D65FF]/[0.03] rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-[#4D65FF]/10 border border-[#4D65FF]/20 flex items-center justify-center text-[#4D65FF] font-mono text-xs font-bold">
                B
              </div>
              <div>
                <div className="text-sm font-semibold text-zinc-900">
                  Commerce Layer
                </div>
                <div className="text-xs text-zinc-500 font-mono">BCP</div>
              </div>
            </div>
            <p className="text-sm text-zinc-500 leading-relaxed">
              Negotiation, commitment, fulfilment, disputes. Determines{" "}
              <em>what</em> to pay, <em>when</em>, and under what conditions.
            </p>
          </div>

          <div className="flex justify-center">
            <div className="w-px h-6 bg-zinc-200" />
          </div>

          <div className="border border-zinc-200 bg-zinc-50/50 rounded-xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-zinc-100 border border-zinc-200 flex items-center justify-center text-zinc-500 font-mono text-xs font-bold">
                402
              </div>
              <div>
                <div className="text-sm font-semibold text-zinc-900">
                  Payment Layer
                </div>
                <div className="text-xs text-zinc-500 font-mono">x402</div>
              </div>
            </div>
            <p className="text-sm text-zinc-500 leading-relaxed">
              Stablecoin transfer over HTTP 402. Trustless, on-chain, final.
            </p>
          </div>
        </div>

        {/* Escrow flow explanation */}
        <div className="border border-zinc-200 rounded-xl p-6 bg-white">
          <h3 className="text-sm font-semibold text-zinc-900 mb-4">How escrow works</h3>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-[#4D65FF]/10 border border-[#4D65FF]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-[10px] font-bold text-[#4D65FF]">1</span>
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-800">Buyer commits &rarr; USDC locked</div>
                <div className="text-xs text-zinc-500 mt-0.5">When buyer accepts a quote, USDC is transferred to the on-chain escrow contract. Neither party can withdraw unilaterally.</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-[10px] font-bold text-emerald-600">2</span>
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-800">Seller fulfils &rarr; escrow releases</div>
                <div className="text-xs text-zinc-500 mt-0.5">Seller delivers the goods or service and submits a signed fulfilment proof. The smart contract verifies the signature and releases USDC to the seller.</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-red-50 border border-red-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-[10px] font-bold text-red-500">?</span>
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-800">Dispute &rarr; escrow frozen</div>
                <div className="text-xs text-zinc-500 mt-0.5">Either party can raise a dispute before fulfilment. Funds stay locked in the contract until resolution — no middleman, no manual intervention.</div>
              </div>
            </div>
          </div>
        </div>

        {/* Key properties */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="border border-zinc-200 rounded-xl p-4 text-center">
            <div className="text-sm font-semibold text-zinc-900 mb-1">Start simple</div>
            <div className="text-xs text-zinc-500">No auth, no settlement, no infra required to begin</div>
          </div>
          <div className="border border-zinc-200 rounded-xl p-4 text-center">
            <div className="text-sm font-semibold text-zinc-900 mb-1">Add trust later</div>
            <div className="text-xs text-zinc-500">Ed25519 signatures, x402 payments, or on-chain escrow</div>
          </div>
          <div className="border border-zinc-200 rounded-xl p-4 text-center">
            <div className="text-sm font-semibold text-zinc-900 mb-1">Any platform</div>
            <div className="text-xs text-zinc-500">HTTP-native. Works with any agent framework or language</div>
          </div>
        </div>
      </div>
    </Section>
  );
}

// ─── Quick Start ──────────────────────────────────────────────────────────────

const tabs = [
  {
    label: "Seller",
    code: `import { BCPSeller } from 'bcp-protocol';

const seller = new BCPSeller({
  network: 'base-sepolia',
});

await seller.listen({
  port: 3001,
  orgId: 'my-company',
  markup: 15,
});`,
  },
  {
    label: "Buyer",
    code: `import { BCPBuyer } from 'bcp-protocol';

const buyer = new BCPBuyer({
  network: 'base-sepolia',
});

const deal = await buyer.purchase({
  sellerEndpoint: 'https://seller.example.com',
  item: { description: 'API Data Feed', qty: 1 },
  budget: 25,
});

console.log(deal.lockTxHash, deal.releaseTxHash);`,
  },
  {
    label: "Multi-seller RFQ",
    code: `const result = await buyer.requestQuotes({
  sellers: [
    'https://seller-a.com',
    'https://seller-b.com',
  ],
  item: {
    description: 'Market Research Report',
    qty: 1,
  },
  budget: 50,
});

console.log(\`Best price: $\${result.best.quote.offer.price}\`);
await result.commit();`,
  },
];

function tokenize(line: string): React.ReactNode[] {
  const tokens: React.ReactNode[] = [];
  const parts = line.split(
    /(\bimport\b|\bfrom\b|\bawait\b|\bconst\b|\bnew\b|\basync\b|\bconsole\.log\b)/g
  );
  parts.forEach((part, i) => {
    if (
      ["import", "from", "await", "const", "new", "async", "console.log"].includes(
        part
      )
    ) {
      tokens.push(
        <span key={i} className="token-keyword">
          {part}
        </span>
      );
    } else {
      const strParts = part.split(/('(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g);
      strParts.forEach((sp, j) => {
        if (
          (sp.startsWith("'") && sp.endsWith("'")) ||
          (sp.startsWith("`") && sp.endsWith("`"))
        ) {
          tokens.push(
            <span key={`${i}-${j}`} className="token-string">
              {sp}
            </span>
          );
        } else {
          const numParts = sp.split(/(\b\d+\b)/g);
          numParts.forEach((np, k) => {
            if (/^\d+$/.test(np)) {
              tokens.push(
                <span key={`${i}-${j}-${k}`} className="token-number">
                  {np}
                </span>
              );
            } else {
              tokens.push(<span key={`${i}-${j}-${k}`}>{np}</span>);
            }
          });
        }
      });
    }
  });
  return tokens;
}

function QuickStart() {
  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(tabs[activeTab].code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Section id="quickstart" className="max-w-5xl mx-auto">
      <div className="text-center mb-14">
        <SectionLabel>Quick Start</SectionLabel>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 mb-3">
          Start in minutes
        </h2>
        <p className="text-zinc-500 max-w-lg mx-auto">
          Full TypeScript SDK with built-in escrow, negotiation, and settlement.
        </p>
      </div>

      {/* Install */}
      <div className="flex justify-center mb-8">
        <div className="inline-flex items-center gap-3 bg-zinc-900 rounded-lg px-5 py-2.5 font-mono text-sm shadow-sm">
          <span className="text-zinc-500 select-none">$</span>
          <span className="text-zinc-300">npm install</span>
          <span className="text-[#4D65FF] font-medium">@bcp-protocol/sdk</span>
          <button
            onClick={() => {
              navigator.clipboard.writeText("npm install @bcp-protocol/sdk");
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="ml-1 text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
      </div>

      {/* Code tabs */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden max-w-2xl mx-auto shadow-lg">
        {/* Tab bar */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-1">
          <div className="flex">
            {tabs.map((tab, i) => (
              <button
                key={tab.label}
                onClick={() => setActiveTab(i)}
                className={`px-4 py-3 text-xs font-medium transition-all relative ${
                  activeTab === i
                    ? "text-white"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {tab.label}
                {activeTab === i && (
                  <motion.div
                    layoutId="code-tab"
                    className="absolute bottom-0 left-0 right-0 h-px bg-[#4D65FF]"
                  />
                )}
              </button>
            ))}
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors px-3 py-2"
          >
            {copied ? (
              <>
                <Check size={12} className="text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy size={12} />
                Copy
              </>
            )}
          </button>
        </div>

        {/* Code */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="code-block text-[13px] leading-7 p-5 overflow-x-auto"
          >
            {tabs[activeTab].code.split("\n").map((line, i) => (
              <div key={i} className="flex">
                <span className="select-none text-zinc-700 w-7 flex-shrink-0 text-right pr-3 text-xs">
                  {i + 1}
                </span>
                <span className="text-zinc-300">{tokenize(line)}</span>
              </div>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
    </Section>
  );
}

// ─── Ecosystem ────────────────────────────────────────────────────────────────

const ecosystem = [
  { name: "x402", description: "HTTP 402 Payments", href: "https://x402.org" },
  { name: "Base", description: "L2 by Coinbase", href: "https://base.org" },
  { name: "USDC", description: "Stablecoin settlement", href: "https://www.circle.com/usdc" },
  { name: "ERC-20", description: "Token standard", href: "https://eips.ethereum.org/EIPS/eip-20" },
];

function EcosystemSection() {
  return (
    <Section className="max-w-5xl mx-auto">
      <div className="text-center mb-14">
        <SectionLabel>Ecosystem</SectionLabel>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 mb-3">
          Built for the stack
        </h2>
        <p className="text-zinc-500 max-w-lg mx-auto">
          Composable with the broader agent and on-chain commerce ecosystem.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 max-w-2xl mx-auto">
        {ecosystem.map((item, i) => (
          <motion.a
            key={item.name}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.3, delay: i * 0.06 }}
            className="flex items-center gap-3 bg-white border border-zinc-200 hover:border-zinc-300 rounded-xl px-4 py-3 transition-all group card-hover"
          >
            <div className="w-8 h-8 rounded-lg bg-zinc-50 border border-zinc-200 flex items-center justify-center text-xs font-bold text-zinc-500 group-hover:text-zinc-700 transition-colors">
              {item.name[0]}
            </div>
            <div>
              <div className="text-sm font-medium text-zinc-900">
                {item.name}
              </div>
              <div className="text-[11px] text-zinc-400">{item.description}</div>
            </div>
            <ExternalLink
              size={12}
              className="text-zinc-300 group-hover:text-zinc-400 transition-colors ml-1"
            />
          </motion.a>
        ))}
      </div>
    </Section>
  );
}

// ─── CTA ──────────────────────────────────────────────────────────────────────

function CTASection() {
  return (
    <Section className="max-w-5xl mx-auto">
      <div className="text-center border border-zinc-200 rounded-2xl py-16 px-6 bg-zinc-50/50">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 mb-3">
          Ready to build agent commerce?
        </h2>
        <p className="text-zinc-500 max-w-md mx-auto mb-8 text-sm">
          BCP is open source, Apache 2.0 licensed, and ready for your agents.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <a
            href="https://github.com/lucidedev/bcp-protocol"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-white font-medium px-5 py-2.5 rounded-lg transition-all text-sm"
          >
            <GithubIcon size={15} />
            View on GitHub
          </a>
          <a
            href="https://github.com/lucidedev/bcp-protocol/blob/main/spec/SPEC-v0.2.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 border border-zinc-200 hover:border-zinc-300 bg-white text-zinc-700 font-medium px-5 py-2.5 rounded-lg transition-all text-sm"
          >
            Read the Spec
            <ExternalLink size={13} />
          </a>
        </div>
      </div>
    </Section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-zinc-200 py-10 px-6">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-[#4D65FF] flex items-center justify-center text-white font-bold text-[10px]">
            B
          </div>
          <span className="text-sm text-zinc-500">
            BCP — Business Commerce Protocol
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-zinc-400">
          <span>Apache 2.0</span>
          <span className="w-1 h-1 rounded-full bg-zinc-300" />
          <a
            href="https://github.com/lucidedev/bcp-protocol"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-zinc-600 transition-colors"
          >
            GitHub
          </a>
          <span className="w-1 h-1 rounded-full bg-zinc-300" />
          <span className="font-mono">v0.2.0</span>
        </div>
      </div>
    </footer>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <main className="min-h-screen bg-white">
      <Nav />
      <Hero />
      <DemoFlow />
      <ProblemSection />
      <ProtocolSection />
      <ArchitectureSection />
      <QuickStart />
      <EcosystemSection />
      <CTASection />
      <Footer />
    </main>
  );
}
