import { getAllQueuedActions, removeQueuedAction, type QueuedDeliverPayload, type QueuedStatusPayload } from './db'
import { shipmentApi } from '../api/shipments'

export interface SyncResult {
  trackingId: string
  success: boolean
  error?: string
}

export async function syncQueue(): Promise<SyncResult[]> {
  const actions = await getAllQueuedActions()
  const results: SyncResult[] = []

  for (const action of actions) {
    try {
      if (action.type === 'deliver') {
        const p = action.payload as QueuedDeliverPayload
        const photo = action.photoBlob ?? new Blob([], { type: 'image/jpeg' })
        await shipmentApi.deliver(action.trackingId, {
          keyword: p.keyword,
          recipient_dni: p.recipient_dni,
          contingency: p.contingency,
          current_speed: p.current_speed,
          speed_source: p.speed_source,
          latitude: p.latitude,
          longitude: p.longitude,
          photo,
        })
      } else {
        const p = action.payload as QueuedStatusPayload
        await shipmentApi.updateStatus(action.trackingId, {
          status: p.status as 'delivery_failed',
          location: p.location,
          notes: p.notes,
          rejected_by_recipient: p.rejected_by_recipient,
          current_speed: p.current_speed,
          speed_source: p.speed_source,
          latitude: p.latitude,
          longitude: p.longitude,
        })
      }
      await removeQueuedAction(action.id!)
      results.push({ trackingId: action.trackingId, success: true })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      results.push({ trackingId: action.trackingId, success: false, error: msg ?? 'Error al sincronizar' })
    }
  }

  return results
}
