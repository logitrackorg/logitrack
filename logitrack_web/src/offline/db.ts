import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

interface OfflineDB extends DBSchema {
  routeCache: {
    key: string // driverId
    value: { driverId: string; data: unknown; cachedAt: number }
  }
  actionQueue: {
    key: number
    value: QueuedAction
    indexes: { by_enqueued: number }
  }
  keywordAttempts: {
    key: string // trackingId
    value: { trackingId: string; count: number }
  }
}

export interface QueuedDeliverPayload {
  keyword?: string
  recipient_dni?: string
  contingency?: boolean
  current_speed?: number
  speed_source?: 'simulation' | 'real_gps'
  latitude?: number
  longitude?: number
}

export interface QueuedStatusPayload {
  status: string
  location: string
  notes?: string
  rejected_by_recipient?: boolean
  current_speed?: number
  speed_source?: 'simulation' | 'real_gps'
  latitude?: number
  longitude?: number
}

export interface QueuedAction {
  id?: number
  type: 'deliver' | 'delivery_failed' | 'rejected'
  trackingId: string
  payload: QueuedDeliverPayload | QueuedStatusPayload
  photoBlob?: Blob
  enqueuedAt: number
}

let _db: Promise<IDBPDatabase<OfflineDB>> | null = null

function db(): Promise<IDBPDatabase<OfflineDB>> {
  if (!_db) {
    _db = openDB<OfflineDB>('logitrack_offline', 1, {
      upgrade(d) {
        d.createObjectStore('routeCache', { keyPath: 'driverId' })
        const aq = d.createObjectStore('actionQueue', { keyPath: 'id', autoIncrement: true })
        aq.createIndex('by_enqueued', 'enqueuedAt')
        d.createObjectStore('keywordAttempts', { keyPath: 'trackingId' })
      },
    })
  }
  return _db
}

export async function cacheRoute(driverId: string, data: unknown): Promise<void> {
  const d = await db()
  await d.put('routeCache', { driverId, data, cachedAt: Date.now() })
}

export async function getCachedRoute(driverId: string): Promise<unknown | null> {
  const d = await db()
  const rec = await d.get('routeCache', driverId)
  return rec?.data ?? null
}

export async function enqueueAction(action: Omit<QueuedAction, 'id'>): Promise<void> {
  const d = await db()
  await d.add('actionQueue', action as QueuedAction)
}

export async function getAllQueuedActions(): Promise<QueuedAction[]> {
  const d = await db()
  return d.getAllFromIndex('actionQueue', 'by_enqueued')
}

export async function removeQueuedAction(id: number): Promise<void> {
  const d = await db()
  await d.delete('actionQueue', id)
}

export async function getQueuedCount(): Promise<number> {
  const d = await db()
  return d.count('actionQueue')
}

export async function getKeywordAttempts(trackingId: string): Promise<number> {
  const d = await db()
  const rec = await d.get('keywordAttempts', trackingId)
  return rec?.count ?? 0
}

export async function incrementKeywordAttempts(trackingId: string): Promise<number> {
  const d = await db()
  const existing = await d.get('keywordAttempts', trackingId)
  const count = (existing?.count ?? 0) + 1
  await d.put('keywordAttempts', { trackingId, count })
  return count
}
