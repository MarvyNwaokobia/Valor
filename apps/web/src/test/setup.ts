import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

// Mock Privy auth
vi.mock('@privy-io/react-auth', () => ({
  usePrivy: () => ({ ready: true, authenticated: false, login: vi.fn(), logout: vi.fn(), user: null }),
  PrivyProvider: ({ children }: { children: React.ReactNode }) => children,
}))

// Mock wagmi
vi.mock('wagmi', () => ({
  useConnection: () => ({ address: undefined, isConnected: false }),
  useAccount: () => ({ address: undefined, isConnected: false }),
  WagmiProvider: ({ children }: { children: React.ReactNode }) => children,
}))

// Mock Three.js canvas (no WebGL in test env)
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => children,
  useFrame: vi.fn(),
  useThree: () => ({ camera: {}, gl: {}, scene: {} }),
}))

vi.mock('@react-three/drei', () => ({
  useGLTF: () => ({ scene: { clone: () => ({}) }, animations: [] }),
  useAnimations: () => ({ actions: {}, mixer: null }),
  Environment: () => null,
  OrbitControls: () => null,
}))

// Suppress console.error for known noise
const originalError = console.error
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('Not implemented')) return
    originalError(...args)
  }
})
afterAll(() => { console.error = originalError })
