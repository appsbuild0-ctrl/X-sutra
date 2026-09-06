import { useEffect, useState } from 'react'
import { defaultHub, getHubSnapshot, refreshHub, subscribeHub, type AdminHub } from '../lib/adminHub'

/**
 * Live view of the admin hub. Any mounted consumer (payment QR, Premium/VIP
 * plans, home banner, notification bell) re-renders the instant an admin
 * commits a change through `commitHub`, so edits appear "turant" on the login
 * and home screens without a manual reload.
 */
export function useHub(): AdminHub {
  const [hub, setHub] = useState<AdminHub>(() => getHubSnapshot() ?? defaultHub())

  useEffect(() => {
    // Keep a snapshot even before the async refresh resolves.
    setHub(getHubSnapshot())
    const unsubscribe = subscribeHub(setHub)
    void refreshHub().then(setHub).catch(() => undefined)
    return unsubscribe
  }, [])

  return hub
}
