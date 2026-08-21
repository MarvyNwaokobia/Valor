/// <reference lib="webworker" />
// Valor service worker (Serwist). Its only job here is to make the app
// *installable* (Android/Chrome + desktop need a SW with a fetch handler) and
// to load the app shell fast. Valor is an online game — there is no offline
// mode — so navigations/API stay network-first via Serwist's defaultCache.
import { defaultCache } from '@serwist/next/worker'
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist'
import { Serwist } from 'serwist'

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Injected at build time by @serwist/next with the app-shell asset list.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
})

serwist.addEventListeners()

// Daily reminder pushes from the API's /notifications/daily-run cron sweep
// (apps/api/src/handlers/push.rs). Payload shape is { title, body, url } —
// see PushPayload in apps/api/src/services/push.rs.
self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; url?: string } = {}
  try {
    data = event.data?.json() ?? {}
  } catch {
    /* non-JSON payload — fall back to defaults below */
  }

  const title = data.title ?? 'Valor'
  const url = data.url ?? '/hub'

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body ?? 'Come back and play.',
      icon: '/valor-icon-transparent.png',
      badge: '/valor-icon-transparent.png',
      tag: 'valor-daily-reminder',
      data: { url },
    }),
  )
})

// Focus an already-open Valor tab if there is one, otherwise open the target
// path in a new one — the standard "open or focus" pattern for PWA notification
// clicks.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/hub'

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = clientsList.find((c) => 'focus' in c)
      if (existing) {
        await (existing as WindowClient).focus()
        if ('navigate' in existing) await (existing as WindowClient).navigate(url)
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})
