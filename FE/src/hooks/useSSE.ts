/**
 * Server-sent events over fetch (the endpoint needs an Authorization header, which
 * EventSource cannot send).
 *
 * R-41 / P-42:
 *  - aborts the request on unmount / url change (no leaked streams)
 *  - reconnects with exponential backoff (1s -> 30s, reset after a successful message)
 *  - one connection per hook instance: mount it once in the shell, not per widget
 *  - `onEvent` is called directly (no state churn); throttle refetches with
 *    `useDebouncedCallback` (leading + trailing) inside it.
 *
 *   const refresh = useDebouncedCallback(() => refetch(), 500);
 *   useSSE('/events', { onEvent: () => refresh(), enabled: isAuthenticated });
 */
import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../services/apiClient.ts';
import { getToken } from '../services/session.ts';

export interface SseEvent {
  type: string;
  payload: unknown;
}

export interface UseSseOptions {
  onEvent?: (event: SseEvent) => void;
  enabled?: boolean;
}

export type SseStatus = 'idle' | 'connecting' | 'open' | 'reconnecting';

const MIN_DELAY = 1000;
const MAX_DELAY = 30000;

function parseBlock(block: string): SseEvent | null {
  let type = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    return { type, payload: JSON.parse(data) };
  } catch {
    return { type, payload: data };
  }
}

export function useSSE(url: string, options: UseSseOptions = {}) {
  const { enabled = true } = options;
  const [status, setStatus] = useState<SseStatus>('idle');
  const handlerRef = useRef(options.onEvent);
  useEffect(() => {
    handlerRef.current = options.onEvent;
  });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = MIN_DELAY;

    const schedule = () => {
      if (controller.signal.aborted) return;
      setStatus('reconnecting');
      timer = setTimeout(() => void connect(), delay);
      delay = Math.min(delay * 2, MAX_DELAY);
    };

    async function connect() {
      const token = getToken();
      if (!token || controller.signal.aborted) return;
      setStatus('connecting');
      try {
        const base = (apiClient.defaults.baseURL || '/api/v1').replace(/\/$/, '');
        const res = await fetch(`${base}/${url.replace(/^\//, '')}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (res.status === 401 || res.status === 403) {
          setStatus('idle'); // not allowed: do not hammer the server
          return;
        }
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        setStatus('open');
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() ?? '';
          for (const block of blocks) {
            const evt = parseBlock(block);
            if (!evt) continue;
            delay = MIN_DELAY;
            if (evt.type === 'connected' || evt.type === 'close') continue;
            handlerRef.current?.(evt);
          }
        }
        schedule();
      } catch {
        if (!controller.signal.aborted) schedule();
      }
    }

    // R5F-13: start on the next tick. React StrictMode (dev) mounts, unmounts and remounts effects at once; a
    // request started synchronously was aborted mid-flight by the dev proxy and showed up as a 503 on every load.
    timer = setTimeout(() => void connect(), 0);
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [url, enabled]);

  return { status };
}
