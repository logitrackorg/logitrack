import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DriverShipmentDetail } from '../pages/DriverShipmentDetail';

// ── Hoisted mocks — variable references in vi.mock factories must be hoisted ───
const { mockShipment, mockGetShipment, mockGetRoute } = vi.hoisted(() => ({
  mockShipment: {
    tracking_id: 'LT-TEST1234',
    status: 'out_for_delivery',
    delivery_method: 'ultima_milla',
    weight_kg: 5,
    package_type: 'box',
    is_fragile: false,
    time_window: 'morning',
    delivery_attempts: 0,
    keyword_attempts: 0,
    recipient: {
      name: 'Juan Pérez',
      phone: '1123456789',
      dni: '12345678',
      address: { street: 'Av. Siempreviva 742', city: 'Ciudad de Buenos Aires', province: 'CABA', postal_code: 'C1000' },
      email: '',
    },
    sender: {
      name: 'Empresa S.A.',
      phone: '1198765432',
    },
    special_instructions: '',
    corrections: {},
  },
  mockGetShipment: vi.fn(),
  mockGetRoute: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../api/shipments', () => ({
  shipmentApi: {
    get: mockGetShipment,
    deliver: vi.fn(),
    updateStatus: vi.fn(),
  },
}));

vi.mock('../api/driver', () => ({
  driverApi: {
    getRoute: mockGetRoute,
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
    getFatigueBlockStatus: vi.fn(),
  },
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
    locationReady: true,
    requestLocation: vi.fn(),
  }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '5', role: 'driver' as const, username: 'chofer_caba', driver_type: undefined },
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

describe('Driver shipment routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetShipment.mockResolvedValue(mockShipment);
    mockGetRoute.mockResolvedValue({
      route: {
        id: 'ROUTE-00000001',
        status: 'en_curso',
        date: '2026-06-17',
        driver_id: '5',
        driver_name: 'chofer_caba',
        branch_id: 'caba',
        shipments: [mockShipment],
      },
    });
  });

  it('renders DriverShipmentDetail at /driver/shipments/:trackingId', async () => {
    render(
      <MemoryRouter initialEntries={['/driver/shipments/LT-TEST1234']}>
        <Routes>
          <Route path="/driver/shipments/:trackingId" element={<DriverShipmentDetail />} />
        </Routes>
      </MemoryRouter>
    );

    // Wait for the component to render the shipment tracking ID
    const trackingEl = await screen.findByText('LT-TEST1234');
    expect(trackingEl).toBeDefined();

    // Check that the recipient name appears
    const nameEl = await screen.findByText('Juan Pérez');
    expect(nameEl).toBeDefined();

    // Check driver-specific UI is present (Entregar button)
    const deliverBtn = await screen.findByText('Entregar');
    expect(deliverBtn).toBeDefined();
  });
});
