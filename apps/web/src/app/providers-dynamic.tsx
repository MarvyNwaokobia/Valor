'use client'

import dynamic from 'next/dynamic'

// Web3Auth's imperative SDK touches `window` at module-eval time — must
// never run during SSR. `ssr:false` requires a Client Component, so this
// tiny wrapper exists purely so layout.tsx (a Server Component, needed for
// the `metadata`/`viewport` exports) can still use it.
const Providers = dynamic(() => import('./providers').then((m) => m.Providers), { ssr: false })

export default Providers
