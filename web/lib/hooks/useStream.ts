'use client';

import { useState, useRef, useCallback } from 'react';
import { streamInfer, type InferRequest } from '../daemon';
import {
  appendMessage,
  updateLastAssistantMessage,
  type SessionRecord,
} from '../session-store';

export interface StreamState {
  streaming:    boolean;
  streamingText: string;
  error:        string | null;
}

export function useStream(
  session:    SessionRecord,
  onUpdate:   (session: SessionRecord) => void,
) {
  const [state, setState] = useState<StreamState>({
    streaming:     false,
    streamingText: '',
    error:         null,
  });

  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (userText: string, modelId: string) => {
      if (state.streaming) return;

      // Append user message immediately
      appendMessage(session.id, { role: 'user', content: userText });

      // Placeholder assistant message
      appendMessage(session.id, { role: 'assistant', content: '' });

      setState({ streaming: true, streamingText: '', error: null });

      let accumulated = '';

      try {
        const req: InferRequest = {
          model_id:   modelId,
          prompt:     userText,
          session_id: session.id,
          max_tokens: 2048,
        };

        for await (const token of streamInfer(req)) {
          accumulated += token;
          setState(prev => ({ ...prev, streamingText: accumulated }));
          updateLastAssistantMessage(session.id, accumulated);
        }

        setState({ streaming: false, streamingText: '', error: null });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        updateLastAssistantMessage(session.id, `[Error: ${msg}]`);
        setState({ streaming: false, streamingText: '', error: msg });
      } finally {
        // Trigger re-read of the session from localStorage
        const { getSession } = await import('../session-store');
        const updated = getSession(session.id);
        if (updated) onUpdate(updated);
      }
    },
    [session, state.streaming, onUpdate],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setState(prev => ({ ...prev, streaming: false }));
  }, []);

  return { ...state, send, abort };
}
