import { useEffect, useState } from 'react'
import { Network } from '@capacitor/network'

export function useOffline(): boolean {
  const [isOnline, setIsOnline] = useState(true)

  useEffect(() => {
    let cleanup: (() => void) | undefined

    const init = async () => {
      try {
        const status = await Network.getStatus()
        setIsOnline(status.connected)

        const handle = await Network.addListener('networkStatusChange', (s) => {
          setIsOnline(s.connected)
        })
        cleanup = () => handle.remove()
      } catch {
        // Capacitor no disponible (browser dev) — fallback a eventos DOM
        setIsOnline(navigator.onLine)
        const onOnline = () => setIsOnline(true)
        const onOffline = () => setIsOnline(false)
        window.addEventListener('online', onOnline)
        window.addEventListener('offline', onOffline)
        cleanup = () => {
          window.removeEventListener('online', onOnline)
          window.removeEventListener('offline', onOffline)
        }
      }
    }

    init()
    return () => cleanup?.()
  }, [])

  return isOnline
}
