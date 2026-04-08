'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CompanyCard from './components/CompanyCard';
import type { CompanyProfile } from './components/CompanyCard';
import MessageBubble from './components/MessageBubble';
import ReasoningBubble from './components/ReasoningBubble';
import X402Panel from './components/X402Panel';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { MessageEvent, ReasoningEvent, X402Event, BalanceEvent, DoneEvent } from './lib/types';

// ── Company profiles ──────────────────────────────────────────
const BUYER: CompanyProfile = {
  name: 'Velocity Logistics',
  role: 'buyer',
  logo: '🚛',
  tagline: 'AI-powered freight & last-mile delivery',
  industry: 'Freight & Logistics',
  hq: 'Austin, TX',
  size: '520 trucks · 1,200 employees',
  wallet: '0x17bB...a1c3',
  details: [
    { label: 'Revenue', value: '$142M ARR' },
    { label: 'Stage', value: 'Series C' },
    { label: 'Coverage', value: 'US lower-48' },
    { label: 'Pain point', value: '18% delivery cost increase from route detours' },
  ],
};

const SELLER: CompanyProfile = {
  name: 'Meridian Intelligence',
  role: 'seller',
  logo: '🛰️',
  tagline: 'Real-time geospatial data & route optimization APIs',
  industry: 'Data Analytics',
  hq: 'Denver, CO',
  size: '85 employees · 340+ API clients',
  wallet: '0xE461...2c35',
  details: [
    { label: 'Data sources', value: 'DOT, Waze, municipal feeds' },
    { label: 'API uptime', value: '99.97% (12-mo avg)' },
    { label: 'Update latency', value: '< 12 min (road closures)' },
    { label: 'Specialty', value: 'Fleet route optimization at scale' },
  ],
};

// ── Step definitions ──────────────────────────────────────────
type StepName = 'init' | 'intent' | 'quote' | 'counter' | 'accept' | 'commit' | 'dispute' | 'resolve' | 'fulfil' | 'reset';

const STEPS: { step: StepName; label: string; onchain?: boolean }[] = [
  { step: 'init', label: '▶ Start Demo' },
  { step: 'intent', label: 'Send Intent →' },
  { step: 'quote', label: 'Get Quote →' },
  { step: 'counter', label: 'Counter-Offer →' },
  { step: 'accept', label: 'Accept Deal →' },
  { step: 'commit', label: '🔒 Lock Escrow', onchain: true },
  { step: 'dispute', label: '🚨 Raise Dispute', onchain: true },
  { step: 'resolve', label: '✅ Resolve (2-of-2)', onchain: true },
  { step: 'fulfil', label: '💸 Release Payment', onchain: true },
  { step: 'reset', label: '↻ Reset Wallets', onchain: true },
];

const STEP_SENDER: Record<StepName, 'buyer' | 'seller' | null> = {
  init: null, intent: 'buyer', quote: 'seller',
  counter: 'buyer', accept: 'seller',
  commit: 'buyer', dispute: 'buyer', resolve: 'seller',
  fulfil: 'seller', reset: null,
};

const STEP_LOADING_TEXT: Partial<Record<StepName, string>> = {
  commit: 'Locking USDC in escrow...',
  dispute: 'Freezing escrow on-chain...',
  resolve: 'Approving unfreeze (2-of-2)...',
  fulfil: 'Releasing escrow...',
  reset: 'Resetting wallets...',
};

export default function DemoPage() {
  const [stepIndex, setStepIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<(MessageEvent | ReasoningEvent)[]>([]);
  const [x402Events, setX402Events] = useState<X402Event[]>([]);
  const [buyerBalance, setBuyerBalance] = useState<string | null>(null);
  const [sellerBalance, setSellerBalance] = useState<string | null>(null);
  const [doneData, setDoneData] = useState<DoneEvent | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [showInvoice, setShowInvoice] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const isDone = stepIndex >= STEPS.length;
  const currentStep = isDone ? null : STEPS[stepIndex];

  // Who is about to act (glow on their card)
  const activeSender = !isDone && stepIndex > 0
    ? STEP_SENDER[STEPS[stepIndex].step]
    : null;

  // Auto-scroll thread
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, x402Events, loading]);

  const executeStep = useCallback(async () => {
    if (loading) return;

    // Run Again — reset all UI state
    if (isDone) {
      setStepIndex(0);
      setMessages([]);
      setX402Events([]);
      setBuyerBalance(null);
      setSellerBalance(null);
      setDoneData(null);
      setErrorMsg('');
      setShowInvoice(false);
      return;
    }

    const step = STEPS[stepIndex];
    setLoading(true);
    setErrorMsg('');

    try {
      const res = await fetch('/api/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: step.step }),
      });

      const data = await res.json();

      if (data.error) {
        setErrorMsg(data.error);
        setLoading(false);
        return;
      }

      for (const evt of data.events) {
        switch (evt.type) {
          case 'reasoning':
            setMessages(prev => [...prev, evt as ReasoningEvent]);
            break;
          case 'message':
            setMessages(prev => [...prev, evt as MessageEvent]);
            break;
          case 'x402':
            setX402Events(prev => [...prev, evt as X402Event]);
            break;
          case 'balance':
            setBuyerBalance((evt as BalanceEvent).buyer);
            setSellerBalance((evt as BalanceEvent).seller);
            break;
          case 'done':
            setDoneData(evt as DoneEvent);
            break;
          case 'error':
            setErrorMsg(evt.message);
            break;
        }
      }

      setStepIndex(prev => prev + 1);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  }, [stepIndex, isDone, loading]);

  // Keyboard: Space / Enter / → to advance
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        executeStep();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [executeStep]);

  const buttonLabel = isDone
    ? '↻ Run Again'
    : loading
      ? (currentStep!.onchain ? 'Confirming on-chain...' : 'Processing...')
      : currentStep!.label;

  return (
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">
              BCP <span className="text-primary">Live Demo</span>
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Business Commerce Protocol · Powered by{' '}
              <span className="text-primary">x402</span> ·{' '}
              <span className="text-primary/80">Finance District</span> ·{' '}
              Base Sepolia
            </p>
          </div>
          {/* Step progress dots */}
          {stepIndex > 0 && (
            <div className="flex items-center gap-1.5">
              {STEPS.map((s, i) => (
                <div
                  key={s.step}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i < stepIndex ? 'bg-primary' :
                    i === stepIndex && loading ? 'bg-primary animate-pulse' :
                    i === stepIndex ? 'bg-primary/50' :
                    'bg-muted'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 max-w-6xl mx-auto w-full px-6 py-6 flex flex-col gap-6">
        {/* Tagline — idle state */}
        <AnimatePresence>
          {stepIndex === 0 && !loading && (
            <motion.div
              className="text-center py-8"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.5 }}
            >
              <p className="text-2xl font-bold text-foreground mb-2">
                Watch two AI agents negotiate a B2B deal.
              </p>
              <p className="text-sm text-muted-foreground max-w-lg mx-auto">
                Velocity Logistics needs route optimization data. Meridian Intelligence sells it.
                <br />
                Real negotiation. Real USDC on Base. Real dispute resolution. No humans in the loop.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Company cards */}
        <div className="flex justify-between items-start gap-4">
          <CompanyCard
            profile={BUYER}
            balance={buyerBalance}
            active={activeSender === 'buyer'}
          />
          <div className="shrink-0 flex items-center justify-center pt-12 px-2">
            <AnimatePresence>
              {stepIndex > 0 && !isDone && (
                <motion.div
                  className="flex items-center gap-2 text-xs text-muted-foreground/50"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <span>←</span>
                  <span className="font-mono">BCP</span>
                  <span>→</span>
                </motion.div>
              )}
              {isDone && (
                <motion.div
                  className="flex items-center gap-2"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                >
                  <Badge variant="outline" className="text-green-400 border-green-500/30">✓ DEAL COMPLETE</Badge>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <CompanyCard
            profile={SELLER}
            balance={sellerBalance}
            active={activeSender === 'seller'}
          />
        </div>

        {/* Commerce thread */}
        <div
          ref={threadRef}
          className="flex-1 min-h-[350px] max-h-[500px] overflow-y-auto rounded-xl border border-border bg-background p-4 space-y-3"
        >
          {stepIndex === 0 && !loading && (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm text-muted-foreground/30">Commerce thread will appear here</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={`evt-${i}`}>
              {msg.type === 'reasoning' ? (
                <ReasoningBubble
                  sender={(msg as ReasoningEvent).sender}
                  agentName={(msg as ReasoningEvent).agentName}
                  thought={(msg as ReasoningEvent).thought}
                  action={(msg as ReasoningEvent).action}
                  index={i}
                />
              ) : (
                <>
                  <MessageBubble
                    messageType={(msg as MessageEvent).messageType}
                    sender={(msg as MessageEvent).sender}
                    summary={(msg as MessageEvent).summary}
                    id={(msg as MessageEvent).id}
                    index={i}
                    detailRows={(msg as MessageEvent).detailRows}
                    txHash={(msg as MessageEvent).txHash}
                    explorerUrl={(msg as MessageEvent).explorerUrl}
                  />
                  {(msg as MessageEvent).messageType === 'COMMIT' && x402Events.length > 0 && (
                    <X402Panel events={x402Events} />
                  )}
                </>
              )}
            </div>
          ))}

          {/* Loading indicator for on-chain steps */}
          <AnimatePresence>
            {loading && currentStep?.onchain && (
              <motion.div
                className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                  className="inline-block"
                >
                  ⏳
                </motion.span>
                {STEP_LOADING_TEXT[currentStep.step]}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error */}
          {errorMsg && (
            <motion.div
              className="mx-3 p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-sm text-destructive"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {errorMsg}
            </motion.div>
          )}
        </div>

        {/* Done summary */}
        <AnimatePresence>
          {doneData && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <Card className="border-green-500/20">
                <CardHeader className="pb-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-green-400 border-green-500/30 text-xs">✓ Transaction Complete</Badge>
                    <span className="ml-auto text-xs font-mono text-muted-foreground">{doneData.elapsed}s · Gas: {doneData.gasCost}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-2 text-xs font-mono">
                    <div className="flex gap-6">
                      <div>
                        <span className="text-muted-foreground/50">Price</span>
                        <span className="ml-2 text-foreground">${doneData.price} USDC</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground/50">Invoice</span>
                        <span className="ml-2 text-foreground">{doneData.invoiceId}</span>
                      </div>
                    </div>
                    <div className="h-px bg-border my-1" />
                    <div>
                      <span className="text-muted-foreground/50">Lock tx</span>
                      <a
                        href={doneData.lockUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 text-primary underline underline-offset-2 hover:brightness-125"
                      >
                        {doneData.lockTxHash.substring(0, 14)}... ↗
                      </a>
                    </div>
                    <div>
                      <span className="text-muted-foreground/50">Release tx</span>
                      <a
                        href={doneData.releaseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 text-green-400 underline underline-offset-2 hover:brightness-125"
                      >
                        {doneData.releaseTxHash.substring(0, 14)}... ↗
                      </a>
                    </div>
                    {doneData.resetUrl && (
                      <div>
                        <span className="text-muted-foreground/50">Reset tx</span>
                        <a
                          href={doneData.resetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 text-muted-foreground underline underline-offset-2 hover:brightness-125"
                        >
                          {doneData.resetTxHash.substring(0, 14)}... ↗
                        </a>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Invoice Viewer */}
              {doneData.invoiceXml && (
                <div className="mt-3">
                  <button
                    onClick={() => setShowInvoice(prev => !prev)}
                    className="flex items-center gap-2 text-xs text-primary hover:text-primary/80 transition-colors font-medium"
                  >
                    <span className="font-mono">{showInvoice ? '▾' : '▸'}</span>
                    {showInvoice ? 'Hide' : 'View'} UBL 2.1 Invoice XML
                  </button>
                  <AnimatePresence>
                    {showInvoice && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                      >
                        <pre className="mt-2 p-4 rounded-lg border border-border bg-muted/30 text-[11px] leading-relaxed font-mono text-muted-foreground overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre">
                          {doneData.invoiceXml}
                        </pre>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Step button + hints */}
        <div className="flex flex-col items-center gap-2 pb-6">
          <motion.button
            onClick={executeStep}
            disabled={loading}
            className={`px-8 py-3 rounded-lg font-semibold text-sm text-primary-foreground transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
              isDone ? 'bg-green-600 hover:bg-green-500' :
              currentStep?.onchain ? 'bg-primary hover:bg-primary/90 ring-1 ring-primary/30' :
              'bg-primary hover:bg-primary/90'
            }`}
            whileHover={{ scale: loading ? 1 : 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            {loading && (
              <motion.span
                className="inline-block mr-2"
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
              >⏳</motion.span>
            )}
            {buttonLabel}
          </motion.button>
          {!isDone && !loading && stepIndex > 0 && (
            <span className="text-[10px] text-muted-foreground/40">
              Press <kbd className="px-1 py-0.5 rounded bg-muted text-muted-foreground text-[9px]">Space</kbd> or <kbd className="px-1 py-0.5 rounded bg-muted text-muted-foreground text-[9px]">→</kbd> to advance
            </span>
          )}
          {currentStep?.onchain && !loading && (
            <span className="text-[10px] text-primary/40">
              ⛓ Real on-chain transaction
            </span>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-[10px] text-muted-foreground/40">
          <span>BCP v0.1 · Apache 2.0</span>
          <span>Base Sepolia · USDC · Real on-chain transactions</span>
        </div>
      </footer>
    </main>
  );
}
