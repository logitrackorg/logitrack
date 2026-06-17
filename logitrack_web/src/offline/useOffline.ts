import { useEffect, useState } from 'react'
import { Network } from '@capacitor/network'
import { Capacitor } from '@capacitor/core'

export function useOffline(): boolean {
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  useEffect(() => {
    let cleanup: (() => void) | undefined

    const init = async () => {
      if (Capacitor.isNativePlatform()) {
        // APK nativo: usar Capacitor Network plugin
        const status = await Network.getStatus()
        setIsOnline(status.connected)
        const handle = await Network.addListener('networkStatusChange', (s) => {
          setIsOnline(s.connected)
        })
        cleanup = () => handle.remove()
      } else {
        // Browser dev: eventos DOM estándar
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
