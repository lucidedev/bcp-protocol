'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { X402Event } from '../lib/types';

interface X402PanelProps {
  events: X402Event[];
}

const STEP_LABELS: Record<string, string> = {
  request: '→ POST /bcp/settle',
  challenge: '← 402 Payment Required',
  signed: '→ EIP-191 Signed ✓',
  settled: '← 200 OK',
};

export default function X402Panel({ events }: X402PanelProps) {
  if (events.length === 0) return null;

  const settled = events.find(e => e.step === 'settled');
  const isComplete = !!settled;

  return (
    <motion.div
      className="mx-6 my-2"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      transition={{ duration: 0.4 }}
    >
      <Card className={isComplete ? 'border-green-500/20' : 'border-primary/20'}>
        <CardHeader className="pb-0">
          <div className="flex items-center gap-2">
            <span className="text-xs">⚡</span>
            <Badge variant="outline" className="text-[10px] tracking-widest font-bold text-primary border-primary/30">
              x402
            </Badge>
            <span className="text-xs font-medium text-muted-foreground">Payment Flow</span>
            {isComplete && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="ml-auto">
                <Badge className="text-[10px] bg-green-500/10 text-green-400 border-green-500/20" variant="outline">
                  SETTLED
                </Badge>
              </motion.div>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-3">
          <div className="space-y-2 font-mono text-xs">
            <AnimatePresence>
              {events.map((evt) => (
                <motion.div
                  key={evt.step}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className={`${
                    evt.step === 'settled' ? 'text-green-400' :
                    evt.step === 'signed' ? 'text-primary' :
                    evt.step === 'challenge' ? 'text-amber-400' :
                    'text-muted-foreground'
                  }`}>
                    {STEP_LABELS[evt.step]}
                  </div>

                  {evt.step === 'challenge' && (
                    <motion.div
                      className="pl-4 mt-1 space-y-0.5 text-[11px]"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.15 }}
                    >
                      <div><span className="text-muted-foreground/50">asset:</span> <span className="text-foreground/70">{evt.detail.asset}</span></div>
                      <div><span className="text-muted-foreground/50">amount:</span> <span className="text-foreground/70">${evt.detail.amount}</span></div>
                      <div><span className="text-muted-foreground/50">network:</span> <span className="text-foreground/70">{evt.detail.network}</span></div>
                    </motion.div>
                  )}

                  {evt.step === 'signed' && (
                    <motion.div
                      className="pl-4 mt-1 text-[11px]"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.1 }}
                    >
                      <span className="text-muted-foreground/50">X-PAYMENT:</span>{' '}
                      <span className="text-foreground/70">{evt.detail.signer?.substring(0, 10)}...{evt.detail.signer?.substring(36)}</span>
                    </motion.div>
                  )}

                  {evt.step === 'settled' && (
                    <motion.div
                      className="pl-4 mt-1 space-y-0.5 text-[11px]"
                      initial={{ opacity: 0, scale: 0.97 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.1 }}
                    >
                      <div>
                        <span className="text-muted-foreground/50">txHash:</span>{' '}
                        <a
                          href={evt.detail.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-400 underline underline-offset-2 hover:brightness-125"
                        >
                          {evt.detail.txHash?.substring(0, 14)}... ↗
                        </a>
                      </div>
                      <div><span className="text-muted-foreground/50">gas:</span> <span className="text-foreground/70">{evt.detail.gas} ETH</span></div>
                    </motion.div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
