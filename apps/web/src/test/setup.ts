import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

// Mock Web3Auth's imperative SDK — only its shape, not real auth behavior
vi.mock('@web3auth/modal', () => ({
  Web3Auth: vi.fn().mockImplementation(() => ({
    connected: false,
    connectTo: vi.fn(),
    initModal: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    provider: null,
    walletAdapters: {},
  })),
}))
vi.mock('@/lib/wagmi-config', () => ({
  getWeb3Auth: () => ({ connected: false, connectTo: vi.fn(), walletAdapters: {} }),
  initWeb3Auth: () => Promise.resolve(),
  getLastAdapterError: () => null,
  wagmiConfig: {},
}))

// Mock wagmi
vi.mock('wagmi', () => ({
  useConnection: () => ({ address: undefined, isConnected: false }),
  useAccount: () => ({ address: undefined, isConnected: false, status: 'disconnected' }),
  useConnect: () => ({ connect: vi.fn(), connectors: [], isPending: false, error: null }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
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
