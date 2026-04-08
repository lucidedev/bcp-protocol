'use client';

import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import type { MessageType, EventSender } from '../lib/types';

interface MessageBubbleProps {
  messageType: MessageType;
  sender: EventSender;
  summary: string;
  id: string;
  index: number;
  detailRows?: { label: string; value: string }[];
  txHash?: string;
  explorerUrl?: string;
}

const TYPE_VARIANT: Record<MessageType, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  INTENT: 'outline',
  QUOTE: 'secondary',
  COUNTER: 'outline',
  COMMIT: 'default',
  FULFIL: 'default',
  DISPUTE: 'destructive',
  RESOLVE: 'default',
};

const SENDER_LABEL: Record<EventSender, string> = {
  buyer: 'Velocity Logistics',
  seller: 'Meridian Intelligence',
};

export default function MessageBubble({ messageType, sender, summary, id, index, detailRows, txHash, explorerUrl }: MessageBubbleProps) {
  const isBuyer = sender === 'buyer';
  const isFinal = messageType === 'COMMIT' || messageType === 'FULFIL' || messageType === 'RESOLVE';
  const isDispute = messageType === 'DISPUTE';

  return (
    <motion.div
      className={`flex ${isBuyer ? 'justify-start' : 'justify-end'}`}
      initial={{ opacity: 0, x: isBuyer ? -30 : 30, y: 8 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: 0.45, ease: 'easeOut', delay: 0.05 }}
    >
      <div className={`max-w-[440px] rounded-lg border px-4 py-3 ${
        isDispute
          ? 'border-red-500/30 bg-red-500/5'
          : isFinal
          ? 'border-primary/30 bg-primary/5'
          : 'border-border bg-card'
      }`}>
        {/* Header */}
        <div className="flex items-center gap-2 mb-1.5">
          <Badge variant={TYPE_VARIANT[messageType]} className="text-[10px] tracking-widest font-bold">
            {messageType}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {SENDER_LABEL[sender]}
          </span>
          <span className="text-[10px] text-muted-foreground/50 ml-auto font-mono">
            {id.substring(0, 8)}
          </span>
        </div>

        {/* Summary */}
        <div className="text-sm font-medium text-foreground/90 mb-1">{summary}</div>

        {/* Detail rows */}
        {detailRows && detailRows.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/30 space-y-1">
            {detailRows.map((row, i) => (
              <div key={i} className="flex items-baseline gap-2 text-[11px]">
                <span className="text-muted-foreground/50 shrink-0">{row.label}</span>
                <span className="text-foreground/70">{row.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Tx link */}
        {txHash && explorerUrl && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-mono text-primary/80 hover:text-primary underline underline-offset-2 flex items-center gap-1"
            >
              <span className="text-muted-foreground/50">tx:</span>
              {txHash.substring(0, 10)}...{txHash.substring(58)} ↗
            </a>
          </div>
        )}
      </div>
    </motion.div>
  );
}
