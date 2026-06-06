/**
 * Registers Valor as an app on the GoodDollar Engagement Rewards contract.
 * Run once: node scripts/register-gooddollar.mjs
 *
 * After this runs, GoodDollar's team must call approve() on their side.
 * Check status at: https://gooddollar.org/engagement-rewards (or ask in GD Discord)
 */

import { createWalletClient, createPublicClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { celo } from 'viem/chains'
import { EngagementRewardsSDK } from '@goodsdks/engagement-sdk'

const PRIVATE_KEY    = '0xfe3933d2f01b23cf93266c5b5e6226054db5a607aa22d8f698cc8266db9f0ef0'
const APP_ADDRESS    = '0x43a5BA0da132b21bdACfBc4392b72EeBaF6f2D82'
const REWARDS_CONTRACT = '0x25db74CF4E7BA120526fd87e159CF656d94bAE43'

const account = privateKeyToAccount(PRIVATE_KEY)

const publicClient = createPublicClient({
  chain: celo,
  transport: http('https://forno.celo.org'),
})

const walletClient = createWalletClient({
  account,
  chain: celo,
  transport: http('https://forno.celo.org'),
})

const sdk = new EngagementRewardsSDK(publicClient, walletClient, REWARDS_CONTRACT)

console.log('Checking if Valor is already registered...')
const registered = await sdk.getRegisteredApps()
const applied    = await sdk.getAppliedApps()

const alreadyRegistered = registered.some(a => a.app.toLowerCase() === APP_ADDRESS.toLowerCase())
const alreadyApplied    = applied.some(a => a.app.toLowerCase() === APP_ADDRESS.toLowerCase())

if (alreadyRegistered) {
  console.log('✓ Valor is already registered and approved.')
  process.exit(0)
}

if (alreadyApplied) {
  console.log('✓ Valor has already applied — waiting for GoodDollar approval.')
  process.exit(0)
}

console.log('Submitting applyApp transaction...')
const receipt = await sdk.applyApp(APP_ADDRESS, {
  rewardReceiver: APP_ADDRESS,
  userAndInviterPercentage: 80,  // 80% goes to user + inviter
  userPercentage: 75,            // 75% of that goes to user (25% to inviter)
  description: 'Valor — Web3 fighting game on GoodDollar. Earn G$ by playing.',
  url: 'https://valor-production.up.railway.app',
  email: 'marvynwaokobia@gmail.com',
})

console.log('✓ applyApp submitted!')
console.log('  TX:', receipt.transactionHash)
console.log('')
console.log('Next step: Ask GoodDollar to approve your app.')
console.log('  App address:', APP_ADDRESS)
console.log('  Contact: https://discord.gg/gooddollar or partnerships@gooddollar.org')
