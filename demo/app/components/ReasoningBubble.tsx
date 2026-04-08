'use client';

import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import type { EventSender } from '../lib/types';

interface ReasoningBubbleProps {
  sender: EventSender;
  agentName: string;
  thought: string;
  action: string;
  index: number;
}

export default function ReasoningBubble({ sender, agentName, thought, action, index }: ReasoningBubbleProps) {
  const isBuyer = sender === 'buyer';

  return (
    <motion.div
      className={`flex ${isBuyer ? 'justify-start' : 'justify-end'}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut', delay: 0.02 }}
    >
      <div className={`max-w-[460px] rounded-lg border border-dashed px-4 py-3 ${
        isBuyer
          ? 'border-blue-500/20 bg-blue-500/[0.03]'
          : 'border-amber-500/20 bg-amber-500/[0.03]'
      }`}>
        {/* Agent header */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs">🤖</span>
          <Badge
            variant="outline"
            className={`text-[9px] tracking-wide font-medium ${
              isBuyer
                ? 'text-blue-400 border-blue-500/30'
                : 'text-amber-400 border-amber-500/30'
            }`}
          >
            {agentName}
          </Badge>
          <span className="text-[9px] text-muted-foreground/40 ml-auto uppercase tracking-widest">reasoning</span>
        </div>

        {/* Thought */}
        <p className="text-[12px] text-foreground/60 leading-relaxed italic mb-2">
          &ldquo;{thought}&rdquo;
        </p>

        {/* Action */}
        <div className={`flex items-center gap-1.5 pt-2 border-t ${
          isBuyer ? 'border-blue-500/10' : 'border-amber-500/10'
        }`}>
          <span className="text-[10px]">→</span>
          <span className={`text-[11px] font-medium ${
            isBuyer ? 'text-blue-400/80' : 'text-amber-400/80'
          }`}>
            {action}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
