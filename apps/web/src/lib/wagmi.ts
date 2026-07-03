import { CHAIN_NAMESPACES, type CustomChainConfig } from '@web3auth/modal'

// Web3Auth builds its own wagmi Config internally (see providers.tsx) from
// these chain definitions — there is no separate wagmiConfig to export here.
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
