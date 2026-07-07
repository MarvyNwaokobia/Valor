'use client';

import dynamic from 'next/dynamic';

// Slice 1 graybox playground for the Rift Edge (docs/CLONE_PLAN.md).
// Client-only: the scene is a live WebGL canvas.
const GrayboxVerbScene = dynamic(
  () => import('@/engine/scene/GrayboxVerbScene').then((m) => m.GrayboxVerbScene),
  { ssr: false },
);

export default function VerbPlaygroundPage() {
  return <GrayboxVerbScene />;
}
