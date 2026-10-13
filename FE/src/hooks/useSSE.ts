import { useState, useEffect } from 'react';
import { apiClient } from '../services/apiClient.ts';

export function useSSE(url: string) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    let active = true;
    const token = localStorage.getItem('access_token');
    const connect = async () => {
      try {
        const base = (apiClient.defaults.baseURL || '/api/v1').replace(/\/$/, '');
        const path = url.replace(/^\//, '');
        const fullUrl = `${base}/${path}`;
        const response = await fetch(fullUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'text/event-stream'
          }
        });
        
        if (!response.body) return;
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (active) {
          const { value, done } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          
          // The last part might be incomplete
          buffer = parts.pop() || '';
          
          for (const part of parts) {
            const lines = part.split('\n');
            let eventType = 'message';
            let eventData = '';
            
            for (const line of lines) {
              if (line.startsWith('event: ')) {
                eventType = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                eventData += line.slice(6).trim();
              }
            }
            
            if (eventData) {
              try {
                setData({ type: eventType, payload: JSON.parse(eventData) });
              } catch (e) {
                setData({ type: eventType, payload: eventData });
              }
            }
          }
        }
      } catch (err) {
        if (active) setError(err);
      }
    };
    
    if (token) {
      connect();
    }
    
    return () => {
      active = false;
    };
  }, [url]);

  return { data, error };
}
