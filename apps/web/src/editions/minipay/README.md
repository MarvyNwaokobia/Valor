# MiniPay edition

Everything MiniPay-specific lives in this folder. If you are adding MiniPay
behaviour and find yourself editing a file outside `src/editions/minipay/`,
stop and ask whether it belongs behind an `edition()` check instead.

## The one rule

`editions/minipay/` may import from `engine/`, `components/`, `hooks/`, `lib/`.

**Nothing outside `editions/` imports from this folder.** Shared code asks
`edition().features.bank` and gets an answer; it never knows MiniPay exists.
That rule is the only thing standing between "one app, three doors" and
"three forks that drift apart."

## What makes this edition different

| | web | minipay |
|---|---|---|
| Login | Magic, email or Google | auto-connect, no screen |
| Identity | GoodDollar whitelist | none |
| Earning | real G$ out | in-game balance only |
| Spend currency | G$ | USDm / USDC / USDT |
| Typed-data signing | yes | **no** |
| Endless unlock | after campaign level 15 | immediately |

## Built

- [x] **`detect.ts`** — `isMiniPayHost()`, the single source of the MiniPay
      decision. `editions/index.ts` imports it.
- [x] **`MiniPayProvider.tsx`** — attaches the host wallet with no connect
      button. Goes through wagmi's `injected()` connector rather than
      `lib/walletBridge`; the file's header explains why in full. Net effect:
      `walletBridge`, `useResolvedAuth` and `useActiveWalletClient` all stay
      untouched, and every existing signing call site works unchanged.

## Still to build

- [ ] **`purchase.ts`** — approve-then-buy, replacing the EIP-2612 permit in
      `hooks/useMarketplace.ts`. Biggest chunk of new code in the edition.
      Two taps instead of one signature.
- [ ] **`assets.ts`** — the manifest of compressed variants under `/lite/`.
- [ ] **Copy pass** — apply `copyRules` from `config.ts` across user-facing
      strings. MiniPay rejects "gas", "crypto", "onramp", "offramp" at review.
- [ ] **Legacy transactions** — MiniPay ignores EIP-1559. Do not set
      `maxFeePerGas` / `maxPriorityFeePerGas` on any transaction from here.

## Do not trust this flag on the server

`config.earning` is `false`, but that is a **rendering** decision. The API must
decide for itself which edition a request came from, from a separate key or
origin, never from a client-supplied header. Otherwise a normal browser claims
to be MiniPay, or worse, MiniPay claims to be web and unlocks a real payout.

Get this right before money moves. It is easy now and painful to retrofit.

## Open question for MiniPay

Their listing requirements state a 2MB footprint and a 90+ PageSpeed score.
Valor is a 3D game and will not hit those as written. **Ask what the real bar
is for a game** before committing to an asset strategy. They invited us, so
the question is fair to ask, and the answer decides how far the asset work goes.
