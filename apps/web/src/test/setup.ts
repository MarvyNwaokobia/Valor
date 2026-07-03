import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

// Mock Web3Auth
vi.mock('@web3auth/modal/react', () => ({
  useWeb3Auth: () => ({ isInitialized: true, isConnected: false, web3Auth: { connect: vi.fn() } }),
  useWeb3AuthConnect: () => ({ connect: vi.fn(), isConnected: false, loading: false }),
  useWeb3AuthDisconnect: () => ({ disconnect: vi.fn(), loading: false }),
  useWeb3AuthUser: () => ({ userInfo: null, loading: false }),
  Web3AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@web3auth/modal/react/wagmi', () => ({
  WagmiProvider: ({ children }: { children: React.ReactNode }) => children,
}))

// Mock wagmi
vi.mock('wagmi', () => ({
  useConnection: () => ({ address: undefined, isConnected: false }),
  useAccount: () => ({ address: undefined, isConnected: false }),
  useConfig: () => ({}),
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
