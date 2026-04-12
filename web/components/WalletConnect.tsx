'use client';

import { useState } from 'react';
import { Wallet, ExternalLink } from 'lucide-react';

/**
 * WalletConnect — placeholder for Sui wallet integration.
 *
 * In network_paid mode this will use the Sui Wallet adapter / Suiet.
 * For now it shows a disabled state with a tooltip explaining it's coming
 * in the blockchain team's work.
 */
export function WalletConnect() {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="relative">
      <button
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-surface-3
                   bg-surface-2 text-muted text-xs hover:border-accent/50 hover:text-white
                   transition-colors cursor-not-allowed opacity-60"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        disabled
        title="Wallet connect — coming in network_paid mode"
      >
        <Wallet className="w-3.5 h-3.5" />
        <span className="font-mono">Connect wallet</span>
      </button>

      {showTooltip && (
        <div className="absolute bottom-full right-0 mb-2 w-64 rounded-lg border border-surface-3
                        bg-surface-2 p-3 text-xs text-muted shadow-lg z-50 animate-fade-in">
          <p className="font-medium text-white mb-1">Sui wallet — coming soon</p>
          <p>
            Wallet connect is part of the <code className="text-accent">network_paid</code> mode,
            being built by the blockchain team.
          </p>
          <a
            href="https://docs.sui.io/guides/developer/getting-started/sui-install"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 mt-2 text-accent hover:text-accent-hover"
          >
            <ExternalLink className="w-3 h-3" />
            Sui docs
          </a>
        </div>
      )}
    </div>
  );
}
