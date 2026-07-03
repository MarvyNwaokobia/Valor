import { CHAIN_NAMESPACES, WALLET_ADAPTERS, ADAPTER_EVENTS, type CustomChainConfig } from '@web3auth/base'
import { WEB3AUTH_NETWORK, UX_MODE } from '@web3auth/auth'
import { Web3Auth } from '@web3auth/modal'
import { EthereumPrivateKeyProvider } from '@web3auth/ethereum-provider'
import { createConnector, createConfig, http } from 'wagmi'
import { celo, celoAlfajores } from 'wagmi/chains'
import { metaMask, coinbaseWallet, walletConnect } from 'wagmi/connectors'
import { injected } from 'wagmi'
import { getAddress } from 'viem'

export const clientId = process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID ?? ''

export const celoChainConfig: CustomChainConfig = {
  chainNamespace: CHAIN_NAMESPACES.EIP155,
  chainId: '0xa4ec', // 42220
  rpcTarget: 'https://forno.celo.org',
  displayName: 'Celo',
  ticker: 'CELO',
  tickerName: 'Celo',
  decimals: 18,
  blockExplorerUrl: 'https://celoscan.io',
  logo: 'https://cryptologos.cc/logos/celo-celo-logo.png',
}

export const celoAlfajoresChainConfig: CustomChainConfig = {
  chainNamespace: CHAIN_NAMESPACES.EIP155,
  chainId: '0xaef3', // 44787
  rpcTarget: 'https://alfajores-forno.celo-testnet.org',
  displayName: 'Celo Alfajores',
  ticker: 'CELO',
  tickerName: 'Celo',
  decimals: 18,
  blockExplorerUrl: 'https://alfajores.celoscan.io',
  logo: 'https://cryptologos.cc/logos/celo-celo-logo.png',
}

// Web3Auth's own modal UI is never shown — SignInPanel drives everything,
// calling connectTo(AUTH, {loginProvider}) directly per method.
const MODAL_CONFIG = {
  [WALLET_ADAPTERS.AUTH]: {
    label: 'openlogin',
    loginMethods: {
      google:             { name: 'Google',             showOnModal: false },
      facebook:           { name: 'Facebook',           showOnModal: false },
      reddit:             { name: 'Reddit',             showOnModal: false },
      discord:            { name: 'Discord',            showOnModal: false },
      twitch:             { name: 'Twitch',             showOnModal: false },
      apple:              { name: 'Apple',               showOnModal: false },
      line:               { name: 'Line',                showOnModal: false },
      github:             { name: 'GitHub',              showOnModal: false },
      kakao:              { name: 'Kakao',               showOnModal: false },
      linkedin:           { name: 'LinkedIn',            showOnModal: false },
      twitter:            { name: 'Twitter',             showOnModal: false },
      weibo:              { name: 'Weibo',               showOnModal: false },
      wechat:             { name: 'WeChat',              showOnModal: false },
      email_passwordless: { name: 'Email',               showOnModal: false },
      sms_passwordless:   { name: 'SMS',                 showOnModal: false },
    },
  },
}

let _web3auth: Web3Auth | null = null
let _initPromise: Promise<void> | null = null
let _lastAdapterError: Error | null = null

// The auth adapter swallows errors from the post-redirect rehydration
// connect() — it emits ADAPTER_EVENTS.ERRORED instead of rejecting init(),
// so `web3auth.connected` just silently stays false. Capture the real error
// here so SignInPanel can show *why* sign-in didn't complete.
export function getLastAdapterError(): Error | null {
  return _lastAdapterError
}

export function getWeb3Auth(): Web3Auth {
  if (_web3auth) return _web3auth
  if (typeof window === 'undefined') throw new Error('getWeb3Auth: browser only')

  const privateKeyProvider = new EthereumPrivateKeyProvider({
    config: { chainConfig: celoChainConfig },
  })

  _web3auth = new Web3Auth({
    clientId,
    web3AuthNetwork: WEB3AUTH_NETWORK.SAPPHIRE_MAINNET,
    privateKeyProvider,
    uiConfig: { uxMode: UX_MODE.REDIRECT },
  })

  _web3auth.on(ADAPTER_EVENTS.ERRORED, (err: Error) => {
    _lastAdapterError = err
  })

  return _web3auth
}

// Memoized so concurrent callers (mount effect + button click) share one
// in-flight init instead of racing separate initModal() calls.
export function initWeb3Auth(): Promise<void> {
  if (_initPromise) return _initPromise
  const w = getWeb3Auth()
  _initPromise = w.initModal({ modalConfig: MODAL_CONFIG }).catch((e) => {
    _initPromise = null
    throw e
  })
  return _initPromise
}

// Bridges the already-authenticated Web3Auth provider into wagmi as a
// connector — exposes the Web3Auth-derived EOA directly, no smart-account
// wrapping.
function createWeb3AuthConnector() {
  return createConnector<any>((config) => ({
    id: 'web3auth-eoa',
    name: 'Web3Auth',
    type: 'web3auth-eoa',

    async connect(params?: { isReconnecting?: boolean }) {
      config.emitter.emit('message', { type: 'connecting' })
      const web3auth = getWeb3Auth()
      await initWeb3Auth()

      if (!web3auth.connected) {
        if (params?.isReconnecting) {
          throw new Error('Web3Auth session expired — please sign in again')
        }
        throw new Error('Web3Auth is not connected — call connectTo() before connecting this connector')
      }

      const accounts = await this.getAccounts()
      const chainId = await this.getChainId()
      return { accounts, chainId }
    },

    async disconnect() {
      await getWeb3Auth().logout({ cleanup: true }).catch(() => {})
    },

    async getAccounts() {
      const provider = await this.getProvider()
      if (!provider) return []
      const accounts = (await provider.request({ method: 'eth_accounts' })) as string[]
      return accounts.slice(0, 1).map((a: string) => getAddress(a))
    },

    async getChainId() {
      return celo.id
    },

    async getProvider() {
      await initWeb3Auth().catch(() => {})
      return getWeb3Auth().provider ?? null
    },

    async isAuthorized() {
      try {
        const provider = await this.getProvider()
        if (!provider) return false
        if (!getWeb3Auth().connected) return false
        const accounts = await this.getAccounts()
        return accounts.length > 0
      } catch {
        return false
      }
    },

    onAccountsChanged(accounts: string[]) {
      if (accounts.length === 0) config.emitter.emit('disconnect')
      else config.emitter.emit('change', { accounts: accounts.slice(0, 1).map((a) => getAddress(a)) })
    },

    onChainChanged(chainId: string | number) {
      config.emitter.emit('change', { chainId: Number(chainId) })
    },

    onDisconnect() {
      config.emitter.emit('disconnect')
    },
  }))
}

function buildConnectors() {
  if (typeof window === 'undefined' || !clientId) return []

  const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID

  return [
    createWeb3AuthConnector(),
    injected(),
    metaMask(),
    coinbaseWallet({ appName: 'Enter Valor' }),
    ...(wcProjectId ? [walletConnect({ projectId: wcProjectId })] : []),
  ]
}

export const wagmiConfig = createConfig({
  chains: [celo, celoAlfajores],
  connectors: buildConnectors(),
  transports: {
    [celo.id]: http('https://forno.celo.org'),
    [celoAlfajores.id]: http('https://alfajores-forno.celo-testnet.org'),
  },
  // false: providers.tsx dynamically imports this whole tree with ssr:false
  // already, and Proov's own comment on the equivalent line warns that
  // ssr:true causes a hydration-reconciliation crash when server/client
  // connector sets differ (server always has zero connectors here).
  ssr: false,
})
