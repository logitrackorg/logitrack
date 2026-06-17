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
  routeGeometry: {
    key: string // driverId
    value: { driverId: string; fullCoords: [number, number][]; pendingCoords: [number, number][]; doneCoords: [number, number][]; cachedAt: number }
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
    _db = openDB<OfflineDB>('logitrack_offline', 2, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore('routeCache', { keyPath: 'driverId' })
          const aq = d.createObjectStore('actionQueue', { keyPath: 'id', autoIncrement: true })
          aq.createIndex('by_enqueued', 'enqueuedAt')
          d.createObjectStore('keywordAttempts', { keyPath: 'trackingId' })
        }
        if (oldVersion < 2) {
          d.createObjectStore('routeGeometry', { keyPath: 'driverId' })
        }
      },
    }).then(async (d) => {
      // Al abrir la DB, limpiar keywordAttempts si no hay routeCache del día de hoy.
      // Evita que intentos acumulados de días anteriores bloqueen al chofer.
      const allRoutes = await d.getAll('routeCache')
      const hasToday = allRoutes.some(
        (r) => new Date(r.cachedAt).toISOString().slice(0, 10) === todayDateStr()
      )
      if (!hasToday) await d.clear('keywordAttempts')
      return d
    }).catch((err) => {
      console.error('[offline/db] openDB failed:', err)
      _db = null
      throw err
    })
  }
  return _db
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10)
}

async function clearStaleDataIfNewDay(d: IDBPDatabase<OfflineDB>, driverId: string): Promise<void> {
  const existing = await d.get('routeCache', driverId)
  if (!existing) return
  const cachedDay = new Date(existing.cachedAt).toISOString().slice(0, 10)
  if (cachedDay < todayDateStr()) {
    await d.delete('routeCache', driverId)
    await d.delete('routeGeometry', driverId)
    await d.clear('keywordAttempts')
  }
}

// Limpia todos los datos de la jornada para un chofer. Llamar al finalizar la ruta.
export async function clearDayCache(driverId: string): Promise<void> {
  const d = await db()
  await d.delete('routeCache', driverId)
  await d.delete('routeGeometry', driverId)
  await d.clear('keywordAttempts')
}

export async function cacheRoute(driverId: string, data: unknown): Promise<void> {
  const d = await db()
  await clearStaleDataIfNewDay(d, driverId)
  await d.put('routeCache', { driverId, data, cachedAt: Date.now() })
}

export async function getCachedRoute(driverId: string): Promise<unknown | null> {
  const d = await db()
  const rec = await d.get('routeCache', driverId)
  if (!rec) return null
  // Si el cache es de un día anterior, limpiarlo antes de servirlo para evitar
  // que keywordAttempts viejos bloqueen la validación del día nuevo.
  const cachedDay = new Date(rec.cachedAt).toISOString().slice(0, 10)
  if (cachedDay < todayDateStr()) {
    await d.delete('routeCache', driverId)
    await d.delete('routeGeometry', driverId)
    await d.clear('keywordAttempts')
    return null
  }
  return rec.data
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

export interface CachedRouteGeometry {
  fullCoords: [number, number][]
  pendingCoords: [number, number][]
  doneCoords: [number, number][]
}

export async function cacheRouteGeometry(driverId: string, geom: CachedRouteGeometry): Promise<void> {
  const d = await db()
  await d.put('routeGeometry', { driverId, ...geom, cachedAt: Date.now() })
}

export async function getCachedRouteGeometry(driverId: string): Promise<CachedRouteGeometry | null> {
  const d = await db()
  const rec = await d.get('routeGeometry', driverId)
  if (!rec) return null
  return { fullCoords: rec.fullCoords, pendingCoords: rec.pendingCoords, doneCoords: rec.doneCoords }
}

// Pre-fetchea la geometría OSRM y la guarda en cache cuando el chofer carga su ruta online.
// Se llama en background junto con cacheRoute — si falla no interrumpe nada.
export async function prefetchRouteGeometry(
  driverId: string,
  waypoints: Array<{ latitude: number; longitude: number; status?: string }>,
  origin?: { latitude: number; longitude: number },
  currentLocation?: { lat: number; lng: number },
): Promise<void> {
  if (waypoints.length < 1) return
  // Usar ubicación real del chofer si está disponible; si no, la sucursal como fallback.
  const startPoint = currentLocation
    ? `${currentLocation.lng},${currentLocation.lat}`
    : origin ? `${origin.longitude},${origin.latitude}` : null
  const points = [
    ...(startPoint ? [startPoint] : []),
    ...waypoints.map((wp) => `${wp.longitude},${wp.latitude}`),
  ]
  if (points.length < 2) return
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${points.join(';')}?overview=full&geometries=geojson`,
    )
    const data = await res.json()
    if (data.code !== 'Ok' || !data.routes?.[0]) return
    const coords: [number, number][] = data.routes[0].geometry.coordinates.map(
      (c: number[]) => [c[1], c[0]] as [number, number],
    )
    await cacheRouteGeometry(driverId, { fullCoords: coords, pendingCoords: coords, doneCoords: [] })
  } catch {
    // Fallo silencioso — el mapa funciona sin cache
  }
}
