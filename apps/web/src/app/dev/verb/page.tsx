'use client';

import dynamic from 'next/dynamic';

// Valor clone · slice 1 graybox (docs/the plan.md).
// This dev sandbox is repurposed for the Valor first-person build (Marvy's rule:
// test here without disturbing the live /fight game; attach to /fight only when
// the whole Valor build is done). The old melee GrayboxVerbScene is shelved in
// git history, not mounted.
const ValorScene = dynamic(
  () => import('@/engine/scene/ValorScene').then((m) => m.ValorScene),
  { ssr: false },
);

export default function ValorPlaygroundPage() {
  return <ValorScene />;
}
