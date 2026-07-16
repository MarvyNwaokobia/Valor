'use client';

import { useEffect } from 'react';
import { isChunkLoadError, hardReloadForChunkError } from '@/lib/retryImport';

/**
 * Root error boundary — the last line of defence. It replaces the whole document
 * when even the layout throws, so it renders its own <html>/<body>.
 *
 * The case that used to burn users: a game chunk fails to load (stale deploy or a
 * stalled fetch on a weak connection) and Next's raw "Loading chunk NNNN failed"
 * screen appears with no way out. Here we detect that and self-heal with a single
 * hard reload; anything else gets a branded retry screen instead of a dead end.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunk = isChunkLoadError(error);

  useEffect(() => {
    if (chunk) hardReloadForChunkError();
  }, [chunk]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#04030c',
          color: '#e7e5ea',
          fontFamily: 'Inter, system-ui, sans-serif',
          padding: '24px',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 380 }}>
          <div
            style={{
              fontFamily: 'Cinzel, serif',
              fontWeight: 900,
              letterSpacing: '0.12em',
              fontSize: 22,
              color: '#f4f3f7',
            }}
          >
            VALOR
          </div>
          <p style={{ marginTop: 18, fontSize: 15, lineHeight: 1.5, color: '#b7b4c0' }}>
            {chunk
              ? 'A new version just shipped. Reloading to get you back in the fight…'
              : 'Something broke while loading the game.'}
          </p>
          {!chunk && (
            <button
              onClick={() => reset()}
              style={{
                marginTop: 22,
                padding: '12px 28px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.14)',
                background: 'linear-gradient(180deg,#2a2740,#171528)',
                color: '#fff',
                fontWeight: 700,
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          )}
        </div>
      </body>
    </html>
  );
}
