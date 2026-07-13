import { motion } from 'framer-motion'

/**
 * A small, unobtrusive inline loader — NOT a full-screen takeover. Used as a
 * Suspense fallback / brief pending state. Pages should render their shell
 * immediately and only drop this into the specific area that's still loading.
 */
export default function LoadingScreen() {
  return (
    <div className="w-full flex items-center justify-center py-24">
      <motion.div
        className="w-8 h-8 rounded-full border-2 border-valor-border border-t-valor-gold"
        animate={{ rotate: 360 }}
        transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
      />
    </div>
  )
}
