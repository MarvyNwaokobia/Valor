import type { DecayStatus } from '@/utils/decay'

export default function DecayOverlay({ status }: { status: DecayStatus }) {
  if (status === 'none') return null

  return (
    <>
      {status === 'warning' && (
        <div className="absolute top-3 right-3 z-10 bg-orange-500/20 border border-orange-500/50 text-orange-400 text-xs font-bold px-2 py-1 rounded">
          ⚠ Decay Warning
        </div>
      )}
      {status === 'active' && (
        <>
          <div className="absolute top-3 right-3 z-10 bg-red-500/20 border border-red-500/50 text-red-400 text-xs font-bold px-2 py-1 rounded">
            💀 Decaying
          </div>
          <div className="absolute inset-0 pointer-events-none z-10">
            {/* Crack effect via SVG */}
            <svg className="w-full h-full opacity-20" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline
                points="20,0 25,15 18,18 30,40 22,45 35,70 28,80 40,100"
                fill="none"
                stroke="#ef4444"
                strokeWidth="0.5"
              />
              <polyline
                points="80,0 75,12 82,16 70,38 78,42 65,68 72,78 60,100"
                fill="none"
                stroke="#ef4444"
                strokeWidth="0.5"
              />
            </svg>
          </div>
        </>
      )}
    </>
  )
}
