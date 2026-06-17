import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── Mock state ──────────────────────────────────────────────────────────────
const mockNavigate = vi.fn();

// ── Module mocks (hoisted by vitest) ────────────────────────────────────────

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../api/driver', () => ({
  driverApi: {
    getRoute: vi.fn(),
    startRoute: vi.fn(),
    getTodayCheckin: vi.fn(),
    getCheckinGateStatus: vi.fn(),
    submitCheckin: vi.fn(),
    skipCheckin: vi.fn(),
    submitTouchEvent: vi.fn(),
    submitPVT: vi.fn(),
    getTestEligibility: vi.fn(),
    resetMisfires: vi.fn(),
    fastForwardCheckinTime: vi.fn(),
    getControlPhrase: vi.fn(),
    uploadVoice: vi.fn(),
    markRouteStarted: vi.fn(),
    requestHistory: vi.fn(),
    requestHistoryDeletion: vi.fn(),
    getPersonalHistory: vi.fn(),
    getFatigueBlockStatus: vi.fn(() => Promise.resolve({ blocked: false })),
  },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '5', role: 'driver' as const, username: 'chofer_caba', driver_type: 'intersucursal' as const },
    hasRole: () => false,
    token: 'mock-token',
    logout: vi.fn(),
    setSession: vi.fn(),
    setUser: vi.fn(),
    setToken: vi.fn(),
  }),
}));

vi.mock('../context/OrganizationThemeContext', () => ({
  useOrganizationTheme: () => ({
    config: null,
    loading: false,
    refreshTheme: vi.fn(),
    resetTheme: vi.fn(),
  }),
}));

vi.mock('../hooks/useGeolocation', () => ({
  useGeolocation: () => ({
    position: null,
    mode: 'real' as const,
    isPaused: false,
    stoppedTimeMs: 0,
    pause: vi.fn(),
    play: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock('../hooks/useCurrentSpeed', () => ({
  useCurrentSpeed: () => ({
    speedKmh: 0,
    locationReady: false,
    permissionDenied: false,
    requestLocation: vi.fn(),
  }),
}));

vi.mock('../hooks/useMidRouteFatigue', () => ({
  useMidRouteFatigue: () => ({
    showGate: false,
    misfireCount: 0,
    requiresSleepData: false,
    triggerGate: vi.fn(),
    closeGate: vi.fn(),
  }),
}));

vi.mock('../hooks/useMisfireTracking', () => ({
  useMisfireTracking: () => ({
    misfireCount: 0,
    getMisfires: () => 0,
    resetMisfires: vi.fn(),
    checkinTriggered: false,
    triggerCheckin: vi.fn(),
    closeCheckin: vi.fn(),
  }),
}));

vi.mock('../api/zones', () => ({
  zoneApi: {
    list: () => Promise.resolve([]),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

// Reject getMyTrip → triggers NoTripView
vi.mock('../api/interBranchTrips', () => ({
  interBranchTripsApi: {
    getMyTrip: () => Promise.reject(new Error('no trip')),
    getQR: () => Promise.resolve({ qr_code_base64: '' }),
    startTrip: vi.fn(),
    finishByScan: vi.fn(),
    assignDriver: vi.fn(),
    cancel: vi.fn(),
    listByBranch: vi.fn(),
    calendar: vi.fn(),
    getById: vi.fn(),
    confirmUnload: vi.fn(),
    confirmLoad: vi.fn(),
    claimByVehicleQR: vi.fn(),
    closeByVehicleQR: vi.fn(),
  },
}));

vi.mock('../api/publicTracking', () => ({
  publicTrackingApi: {
    getShipment: vi.fn(() => Promise.resolve({ status: 'loaded' })),
    getBranches: vi.fn(() => Promise.resolve([])),
  },
}));

vi.mock('../api/shipments', () => ({
  shipmentApi: {
    deliver: vi.fn(),
    updateStatus: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    saveDraft: vi.fn(),
    updateDraft: vi.fn(),
    search: vi.fn(),
    getEvents: vi.fn(),
    getComments: vi.fn(),
    addComment: vi.fn(),
    correctShipment: vi.fn(),
    cancelShipment: vi.fn(),
    stats: vi.fn(),
    cancellationStats: vi.fn(),
    avgTimePerStatus: vi.fn(),
    statsDetail: vi.fn(),
    bulkUpdateStatus: vi.fn(),
    getIncidents: vi.fn(),
    reportIncident: vi.fn(),
    moveZone: vi.fn(),
    approveFromRevision: vi.fn(),
    classifyShipment: vi.fn(),
  },
}));

vi.mock('../components/ui/MapView', () => ({ MapView: () => null }));
vi.mock('../components/ui/NextStopCard', () => ({ NextStopCard: () => null }));
vi.mock('../components/KssCheckIn', () => ({ KssCheckIn: () => null }));
vi.mock('../components/driver/DeliveryActionSheet', () => ({ DeliveryActionSheet: () => null }));
vi.mock('../components/ThemeToggle', () => ({ ThemeToggle: () => null }));

vi.mock('../components/ui/CameraCapture', () => ({ CameraCapture: () => null }));
vi.mock('../offline/useOffline', () => ({ useOffline: () => true }));
vi.mock('../offline/db', () => ({
  cacheRoute: vi.fn(),
  getCachedRoute: vi.fn().mockResolvedValue(null),
  enqueueAction: vi.fn(),
  getAllQueuedActions: vi.fn().mockResolvedValue([]),
  getKeywordAttempts: vi.fn().mockResolvedValue(0),
  incrementKeywordAttempts: vi.fn(),
  prefetchRouteGeometry: vi.fn(),
  clearDayCache: vi.fn(),
}));
vi.mock('../offline/sync', () => ({ syncQueue: vi.fn().mockResolvedValue(undefined) }));
vi.mock('bcryptjs', () => ({ compare: vi.fn().mockResolvedValue(false) }));

// ── Component under test ────────────────────────────────────────────────────
import { DriverRoute } from '../pages/DriverRoute';

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/driver/trip']}>
      <DriverRoute />
    </MemoryRouter>,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('DriverRoute — inter-branch view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders inter-branch NoTripView when driver_type is intersucursal and no trip exists', async () => {
    renderRoute();

    // InterBranchTripView loads → getMyTrip rejects → noTrip=true → NoTripView
    expect(await screen.findByText('Sin viajes asignados')).toBeInTheDocument();
  });
});
