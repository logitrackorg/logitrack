import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ToastContainer } from "./components/Toast";
import { SupervisorFatigueGuard } from "./components/SupervisorFatigueGuard";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { TwoFAGuard } from "./components/TwoFAGuard";
import { ThemeProvider } from "./context/ThemeContext";
import { OrganizationThemeProvider } from "./context/OrganizationThemeContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Sidebar } from "./components/Sidebar";
import { useSidebarOffset } from "./components/sidebarLayout";
import { Topbar } from "./components/Topbar";
import { TopbarProvider } from "./components/topbarContext";
import { NotificationsPage } from "./pages/NotificationsPage";
import { Dashboard } from "./pages/Dashboard";
import { KpiDetail } from "./pages/KpiDetail";
import { ShipmentList } from "./pages/ShipmentList";
import { ShipmentDetail } from "./pages/ShipmentDetail";
import { Claims } from "./pages/Claims";
import { SlaAuditLogs } from "./pages/SlaAuditLogs";
import { SlaSettings } from "./pages/SlaSettings";
import { NewShipment } from "./pages/NewShipment";
import { PublicTracking } from "./pages/PublicTracking";
import { Login } from "./pages/Login";
import { DriverRoute } from "./pages/DriverRoute";
import { DriverShipmentDetail } from "./pages/DriverShipmentDetail";
import { VehicleList } from "./pages/VehicleList";
import { VehicleStatus } from "./pages/VehicleStatus";
import { AvailableVehicles } from "./pages/AvailableVehicles";
import { VehicleAssignment } from "./pages/VehicleAssignment";
import { BranchList } from "./pages/BranchList";
import { MLConfig } from "./pages/MLConfig";
import { SystemConfig } from "./pages/SystemConfig";
import { PricingConfig } from "./pages/PricingConfig";
import { RoutingConfig } from "./pages/RoutingConfig";
import { PaymentConfig } from "./pages/PaymentConfig";
import { OrganizationConfig } from "./pages/OrganizationConfig";
import { AdminUsers } from "./pages/AdminUsers";
import { BulkUpload } from "./pages/BulkUpload";
import { AccessLog } from "./pages/AccessLog";
import { UserProfile } from "./pages/UserProfile";
import { DraftList } from "./pages/DraftList";
import { ZoneManagement } from "./pages/ZoneManagement";
import { FatigueConfig } from "./pages/FatigueConfig";
import { AutoReports } from "./pages/AutoReports";
import { SupervisorFatigue } from "./pages/SupervisorFatigue";
import { DriverScanVehicle } from "./pages/DriverScanVehicle";
import { DriverLayout } from "./components/DriverLayout";
import { Repartos } from "./pages/Repartos";
import { OperatorTripReception } from "./pages/OperatorTripReception";
import { InterSucursal } from "./pages/InterSucursal";
import { InterBranchTripsList } from "./pages/InterBranchTripsList";
import { TripsCalendar } from "./pages/TripsCalendar";
import { TwoFAVerify } from "./pages/TwoFAVerify";
import { TwoFASetup } from "./pages/TwoFASetup";
import { NetworkHub } from "./pages/NetworkHub";

/** Layout wrapper for non-driver roles: sidebar (fixed) + topbar (sticky) + main with left offset. */
function AppShell({ children }: { children: React.ReactNode }) {
  const offset = useSidebarOffset();
  return (
    <TopbarProvider>
      <Sidebar />
      <div style={{
        marginLeft: offset,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        transition: "margin-left 0.18s ease",
      }}>
        <Topbar />
        <main style={{ flex: 1 }}>
          {children}
        </main>
      </div>
    </TopbarProvider>
  );
}

function AppRoutes() {
  const { user } = useAuth();

  if (user?.role === "driver") {
    const isInterBranch = user.driver_type === "intersucursal";
    const defaultPath = isInterBranch ? "/driver/scan" : "/driver/route";
    return (
      <Routes>
        <Route element={<ProtectedRoute roles={["driver"]}><DriverLayout /></ProtectedRoute>}>
          <Route path="/driver/route" element={<DriverRoute />} />
          <Route path="/driver/trip" element={<DriverRoute />} />
          <Route path="/driver/scan" element={<DriverScanVehicle />} />
          <Route path="/driver/shipments/:trackingId" element={<DriverShipmentDetail />} />
          <Route path="/profile" element={<UserProfile />} />
        </Route>
        <Route path="*" element={<Navigate to={defaultPath} replace />} />
      </Routes>
    );
  }

  // Unauthenticated → only the login route, sin shell.
  if (!user) {
    return (
      <main>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </main>
    );
  }

  return (
    <SupervisorFatigueGuard>
    <AppShell>
      <Routes>
        <Route path="/login" element={<Navigate to={user.role === "admin" ? "/admin/users" : "/"} replace />} />

        <Route path="/dashboard" element={
          <ProtectedRoute roles={["supervisor", "manager"]}>
            <Dashboard />
          </ProtectedRoute>
        } />

        <Route path="/kpi-detail" element={
          <ProtectedRoute roles={["supervisor", "manager", "admin"]}>
            <KpiDetail />
          </ProtectedRoute>
        } />

        <Route path="/" element={
          <ProtectedRoute roles={["operator", "supervisor", "manager"]}>
            <ShipmentList />
          </ProtectedRoute>
        } />

        <Route path="/sla-audit" element={
          <ProtectedRoute roles={["supervisor", "manager"]}>
            <SlaAuditLogs />
          </ProtectedRoute>
        } />

        <Route path="/admin/sla-config" element={
          <ProtectedRoute roles={["admin"]}>
            <SlaSettings />
          </ProtectedRoute>
        } />

        <Route path="/claims" element={
          <ProtectedRoute roles={["admin", "operator", "supervisor", "manager"]}>
            <Claims />
          </ProtectedRoute>
        } />

        <Route path="/claims/:id" element={
          <ProtectedRoute roles={["admin", "operator", "supervisor", "manager"]}>
            <Claims />
          </ProtectedRoute>
        } />

        <Route path="/shipments/:trackingId" element={
          <ProtectedRoute roles={["operator", "supervisor", "manager"]}>
            <ShipmentDetail />
          </ProtectedRoute>
        } />

        <Route path="/calendar" element={
          <ProtectedRoute roles={["operator", "supervisor", "manager"]}>
            <TripsCalendar />
          </ProtectedRoute>
        } />

        <Route path="/inter-branch-trips/:id/recepcion" element={
          <ProtectedRoute roles={["operator", "supervisor"]}>
            <OperatorTripReception />
          </ProtectedRoute>
        } />

        <Route path="/new" element={
          <ProtectedRoute roles={["operator", "supervisor"]}>
            <NewShipment />
          </ProtectedRoute>
        } />

        <Route path="/drafts" element={
          <ProtectedRoute roles={["operator", "supervisor"]}>
            <DraftList />
          </ProtectedRoute>
        } />

        <Route path="/vehicles" element={
          <ProtectedRoute roles={["operator", "supervisor", "manager", "admin"]}>
            <VehicleList />
          </ProtectedRoute>
        } />

        <Route path="/vehicles/:plate/status" element={
          <ProtectedRoute roles={["supervisor", "admin"]}>
            <VehicleStatus />
          </ProtectedRoute>
        } />
        <Route path="/vehicles/:plate/assign" element={
          <ProtectedRoute roles={["supervisor", "admin"]}>
            <VehicleAssignment />
          </ProtectedRoute>
        } />
        <Route path="/vehicles/available" element={
          <ProtectedRoute roles={["supervisor", "admin"]}>
            <AvailableVehicles />
          </ProtectedRoute>
        } />

        <Route path="/branches" element={
          <ProtectedRoute roles={["supervisor", "manager", "admin"]}>
            <BranchList />
          </ProtectedRoute>
        } />

        <Route path="/ml-config" element={
          <ProtectedRoute roles={["admin"]}>
            <MLConfig />
          </ProtectedRoute>
        } />

        <Route path="/system-config" element={
          <ProtectedRoute roles={["admin"]}>
            <SystemConfig />
          </ProtectedRoute>
        } />

        <Route path="/pricing-config" element={
          <ProtectedRoute roles={["admin"]}>
            <PricingConfig />
          </ProtectedRoute>
        } />

        <Route path="/payment-config" element={
          <ProtectedRoute roles={["admin"]}>
            <PaymentConfig />
          </ProtectedRoute>
        } />

        <Route path="/repartos" element={
          <ProtectedRoute roles={["operator", "supervisor"]}>
            <Repartos />
          </ProtectedRoute>
        } />

        <Route path="/inter-sucursal" element={
          <ProtectedRoute roles={["operator", "supervisor"]}>
            <InterSucursal />
          </ProtectedRoute>
        } />

        <Route path="/viajes" element={
          <ProtectedRoute roles={["operator", "supervisor", "manager"]}>
            <InterBranchTripsList />
          </ProtectedRoute>
        } />

        <Route path="/reports/drivers" element={<Navigate to="/dashboard?tab=choferes" replace />} />
        <Route path="/reports/incidents" element={<Navigate to="/dashboard?tab=reclamos" replace />} />
        <Route path="/reports/billing" element={<Navigate to="/dashboard?tab=facturacion" replace />} />
        <Route path="/reports/branch-ranking" element={<Navigate to="/dashboard?tab=ranking" replace />} />
        <Route path="/reports/volume-by-window" element={<Navigate to="/dashboard?tab=volumen" replace />} />
        <Route path="/reports/return-metrics" element={<Navigate to="/dashboard?tab=retorno" replace />} />
        <Route path="/reports/success-rate" element={<Navigate to="/dashboard?tab=exito" replace />} />

        <Route path="/red" element={
          <ProtectedRoute roles={["manager", "admin"]}>
            <NetworkHub />
          </ProtectedRoute>
        } />

        {/* Legacy redirects */}
        <Route path="/routing" element={<Navigate to="/inter-sucursal" replace />} />
        <Route path="/operations/trips" element={<Navigate to="/viajes" replace />} />

        <Route path="/routing-config" element={
          <ProtectedRoute roles={["admin"]}>
            <RoutingConfig />
          </ProtectedRoute>
        } />

        <Route path="/fatigue-config" element={
          <ProtectedRoute roles={["admin"]}>
            <FatigueConfig />
          </ProtectedRoute>
        } />

        <Route path="/supervisor/fatigue" element={
          <ProtectedRoute roles={["supervisor", "manager"]}>
            <SupervisorFatigue />
          </ProtectedRoute>
        } />

        <Route path="/zones" element={
          <ProtectedRoute roles={["admin"]}>
            <ZoneManagement />
          </ProtectedRoute>
        } />

        <Route path="/organization" element={
          <ProtectedRoute roles={["admin"]}>
            <OrganizationConfig />
          </ProtectedRoute>
        } />

        <Route path="/admin/users" element={
          <ProtectedRoute roles={["admin"]}>
            <AdminUsers />
          </ProtectedRoute>
        } />

        <Route path="/bulk-upload" element={
          <ProtectedRoute roles={["operator", "supervisor"]}>
            <BulkUpload />
          </ProtectedRoute>
        } />

        <Route path="/admin/access-logs" element={
          <ProtectedRoute roles={["admin"]}>
            <AccessLog />
          </ProtectedRoute>
        } />

        <Route path="/profile" element={
          <ProtectedRoute>
            <UserProfile />
          </ProtectedRoute>
        } />

        <Route path="/notifications" element={
          <ProtectedRoute roles={["operator", "supervisor", "manager", "admin"]}>
            <NotificationsPage />
          </ProtectedRoute>
        } />

        <Route path="/auto-reports" element={
          <ProtectedRoute roles={["manager"]}>
            <AutoReports />
          </ProtectedRoute>
        } />

        <Route path="*" element={<Navigate to={user.role === "admin" ? "/admin/users" : "/"} replace />} />
      </Routes>
      <ToastContainer />
    </AppShell>
    </SupervisorFatigueGuard>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <OrganizationThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <TwoFAGuard>
            <Routes>
              <Route path="/track" element={<PublicTracking />} />
              {/* Rutas de 2FA: accesibles sin sesión establecida */}
<Route path="/2fa/verify" element={<TwoFAVerify />} />
<Route path="/2fa/setup-required" element={<TwoFASetup required />} />
<Route path="/2fa/setup" element={<TwoFASetup />} />
              <Route path="*" element={<AppRoutes />} />
            </Routes>
          </TwoFAGuard>
        </BrowserRouter>
      </AuthProvider>
      </OrganizationThemeProvider>
    </ThemeProvider>
  );
}

