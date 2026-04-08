'use client';

import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface CompanyProfile {
  name: string;
  role: 'buyer' | 'seller';
  logo: string;
  tagline: string;
  industry: string;
  hq: string;
  size: string;
  wallet: string;
  details: { label: string; value: string }[];
}

interface CompanyCardProps {
  profile: CompanyProfile;
  balance: string | null;
  active: boolean;
}

export default function CompanyCard({ profile, balance, active }: CompanyCardProps) {
  return (
    <motion.div
      animate={{
        boxShadow: active
          ? '0 0 24px oklch(0.7 0.15 290 / 0.25)'
          : '0 0 0px transparent',
      }}
      transition={{ duration: 0.4 }}
      className="rounded-xl flex-1"
    >
      <Card className={cn(
        'transition-colors duration-300 border',
        active ? 'border-primary/50' : 'border-border'
      )}>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{profile.logo}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] uppercase tracking-widest text-primary border-primary/30">
                  {profile.role}
                </Badge>
                {active && (
                  <motion.div
                    className="w-2 h-2 rounded-full bg-primary"
                    animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                  />
                )}
              </div>
              <CardTitle className="mt-1 text-base leading-tight">{profile.name}</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">{profile.tagline}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Company details grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <DetailRow label="Industry" value={profile.industry} />
            <DetailRow label="HQ" value={profile.hq} />
            <DetailRow label="Size" value={profile.size} />
            {profile.details.map(d => (
              <DetailRow key={d.label} label={d.label} value={d.value} />
            ))}
          </div>

          {/* Wallet + Balance */}
          <div className="pt-2 border-t border-border/50">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[10px] text-muted-foreground/50 font-mono tracking-tight">
                {profile.wallet}
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">USDC Balance</span>
              <motion.span
                key={balance}
                className="text-xl font-mono font-bold text-foreground"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                {balance !== null ? `$${parseFloat(balance).toFixed(2)}` : '—'}
              </motion.span>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">{label}</span>
      <span className="text-[11px] text-foreground/80 leading-tight">{value}</span>
    </div>
  );
}
