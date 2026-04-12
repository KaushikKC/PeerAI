'use client';

import { useNodeStatus } from '@/lib/hooks/useNodeStatus';
import { Cpu, Wifi, WifiOff, Activity } from 'lucide-react';
import clsx from 'clsx';

export function NodeStatusBar() {
  const { available, health, peers, latencyMs } = useNodeStatus();

  return (
    <div className="flex items-center gap-4 px-4 py-2 border-t border-surface-2 bg-surface-1 text-xs text-muted select-none">
      {/* Connection dot */}
      <span className="flex items-center gap-1.5">
        {available ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-50" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            <Wifi className="h-3 w-3 text-green-500" />
            <span className="text-green-400">daemon online</span>
          </>
        ) : (
          <>
            <span className="inline-flex rounded-full h-2 w-2 bg-red-500" />
            <WifiOff className="h-3 w-3 text-red-400" />
            <span className="text-red-400">daemon offline</span>
          </>
        )}
      </span>

      {available && health && (
        <>
          <Separator />
          <span className="flex items-center gap-1">
            <Cpu className="h-3 w-3" />
            <span>{health.mode}</span>
          </span>

          {latencyMs !== null && (
            <>
              <Separator />
              <span className="flex items-center gap-1">
                <Activity className="h-3 w-3" />
                <span
                  className={clsx(
                    latencyMs < 100  && 'text-green-400',
                    latencyMs < 500  && latencyMs >= 100 && 'text-yellow-400',
                    latencyMs >= 500 && 'text-red-400',
                  )}
                >
                  {latencyMs} ms
                </span>
              </span>
            </>
          )}

          {peers && peers.count > 0 && (
            <>
              <Separator />
              <span>{peers.count} peer{peers.count !== 1 ? 's' : ''}</span>
            </>
          )}

          <Separator />
          <span>v{health.version}</span>
        </>
      )}

      {/* Right side — keyboard hint */}
      <span className="ml-auto flex items-center gap-3">
        <kbd className="px-1.5 py-0.5 rounded border border-surface-3 bg-surface-2 text-[10px] font-mono">
          ⌘ K
        </kbd>
        <span>new chat</span>
      </span>
    </div>
  );
}

function Separator() {
  return <span className="text-surface-3">·</span>;
}
