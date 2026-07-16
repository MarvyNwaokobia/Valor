'use client';

import { useEffect } from 'react';
import { isChunkLoadError, hardReloadForChunkError } from '@/lib/retryImport';

/**
 * Page-level error boundary — catches runtime errors inside the route tree while
 * keeping the root layout mounted. Chunk-load failures self-heal with a single
 * hard reload; everything else offers a retry that re-renders the segment.
 */
export default function AppError({
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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#04030c',
        color: '#e7e5ea',
        fontFamily: 'Inter, system-ui, sans-serif',
        padding: 24,
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
            ? 'A new version just shipped. Reloading…'
            : 'Something broke. Give it another go.'}
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
    </div>
  );
}
