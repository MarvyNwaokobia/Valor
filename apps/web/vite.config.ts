import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Stub optional Solana peer deps required by @privy-io/react-auth
    {
      name: 'stub-optional-solana',
      resolveId(id) {
        if (id === '@solana-program/system') return '\0stub-solana-system'
        return null
      },
      load(id) {
        if (id === '\0stub-solana-system') {
          return `export function getTransferSolInstruction() { throw new Error('Solana not supported') }; export default {}`
        }
        return null
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
