// Route WalletConnect's relay WebSocket through our own backend, because many mobile
// carriers/ISPs can't resolve `relay.walletconnect.*` — which kills external-wallet login
// on mobile, the platform this game is mostly played on.
//
// KEY: we only rewrite the TRANSPORT (which host the socket connects to), never the
// payload. The WalletConnect SDK still thinks it's talking to relay.walletconnect.org and
// signs its relay auth token with `aud: wss://relay.walletconnect.org`, so the real relay
// (which our proxy forwards to) still accepts the token. Non-relay sockets — including the
// game's own /ws/battle — pass through untouched.

const RELAY_HOSTS = new Set(['relay.walletconnect.org', 'relay.walletconnect.com']);

export function installWalletConnectRelayProxy(): void {
  if (typeof window === 'undefined') return;
  const RealWS = window.WebSocket;
  // Idempotent — React strict mode / re-renders must not double-wrap.
  if ((RealWS as unknown as { __valorProxied?: boolean }).__valorProxied) return;

  const api = process.env.NEXT_PUBLIC_API_URL;
  if (!api) return; // nothing to proxy through
  const proxyBase = api.replace(/^http/i, 'ws').replace(/\/+$/, '') + '/relay';

  const Proxied = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    let target = url;
    try {
      const u = new URL(typeof url === 'string' ? url : url.toString());
      if (RELAY_HOSTS.has(u.hostname)) {
        target = proxyBase + u.search; // keep the auth/projectId/ua query verbatim
      }
    } catch {
      /* not a parseable URL — leave it alone */
    }
    return new RealWS(target as string, protocols);
  } as unknown as typeof WebSocket;

  // Preserve the static surface of the native constructor.
  Proxied.prototype = RealWS.prototype;
  Object.defineProperty(Proxied, 'name', { value: 'WebSocket' });
  (Proxied as unknown as Record<string, unknown>).CONNECTING = RealWS.CONNECTING;
  (Proxied as unknown as Record<string, unknown>).OPEN = RealWS.OPEN;
  (Proxied as unknown as Record<string, unknown>).CLOSING = RealWS.CLOSING;
  (Proxied as unknown as Record<string, unknown>).CLOSED = RealWS.CLOSED;
  (Proxied as unknown as { __valorProxied: boolean }).__valorProxied = true;

  window.WebSocket = Proxied;
}
