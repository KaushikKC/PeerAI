'use client';

import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { User, Bot } from 'lucide-react';
import clsx from 'clsx';
import type { Message } from '@/lib/session-store';

interface Props {
  message:    Message;
  streaming?: boolean;
}

export const MessageBubble = memo(function MessageBubble({ message, streaming }: Props) {
  const isUser = message.role === 'user';

  return (
    <div
      className={clsx(
        'group flex gap-3 px-4 py-5 animate-fade-in',
        isUser ? 'bg-transparent' : 'bg-surface-1',
      )}
    >
      {/* Avatar */}
      <div
        className={clsx(
          'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs',
          isUser
            ? 'bg-accent text-white'
            : 'bg-surface-3 text-accent',
        )}
      >
        {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium text-muted mb-1.5">
          {isUser ? 'You' : 'DeAI'}
        </div>

        {isUser ? (
          /* User messages: plain text, pre-wrap */
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-gray-200">
            {message.content}
          </p>
        ) : (
          /* Assistant messages: markdown rendered */
          <div
            className={clsx(
              'prose-deai text-gray-200',
              streaming && 'cursor-blink',
            )}
          >
            {message.content ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            ) : (
              <span className="text-muted text-sm">Thinking…</span>
            )}
          </div>
        )}

        {/* Timestamp on hover */}
        <div className="mt-2 text-[10px] text-muted opacity-0 group-hover:opacity-100 transition-opacity">
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour:   '2-digit',
            minute: '2-digit',
          })}
          {message.nodeId && (
            <span className="ml-2 font-mono">via {message.nodeId.slice(0, 12)}…</span>
          )}
        </div>
      </div>
    </div>
  );
});
