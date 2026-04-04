import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { useIsMobile } from "./hooks/useIsMobile";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Dashboard } from "./pages/Dashboard";
import { ShipmentList } from "./pages/ShipmentList";
import { ShipmentDetail } from "./pages/ShipmentDetail";
import { NewShipment } from "./pages/NewShipment";
import { PublicTracking } from "./pages/PublicTracking";
import { Login } from "./pages/Login";
import { DriverRoute } from "./pages/DriverRoute";
import { DriverShipmentDetail } from "./pages/DriverShipmentDetail";
import { VehicleList } from "./pages/VehicleList";
import { BranchList } from "./pages/BranchList";
import { MLConfig } from "./pages/MLConfig";

const ROLE_LABELS: Record<string, string> = {
  operator: "Operator",
  supervisor: "Supervisor",
  manager: "Manager",
  admin: "Admin",
  driver: "Chofer",
};

function Nav() {
  const { user, logout, hasRole } = useAuth();
  const isMobile = useIsMobile();
  if (!user) return null;

  return (
    <nav style={{
      background: "#1e3a5f", color: "#fff",
      padding: isMobile ? "8px 12px" : "0 24px",
      display: "flex", alignItems: "center",
      gap: isMobile ? 10 : 24,
      minHeight: 52, flexWrap: "wrap", rowGap: 6,
    }}>
      <span style={{ fontWeight: 800, fontSize: isMobile ? 15 : 17, letterSpacing: 1 }}>LogiTrack</span>

      {hasRole("supervisor", "manager", "admin") && (
        <NavLink to="/dashboard" style={navStyle}>Dashboard</NavLink>
      )}
      <NavLink to="/" end style={navStyle}>Shipments</NavLink>
      <NavLink to="/track" style={navStyle}>Track</NavLink>
      {hasRole("supervisor", "manager", "admin") && (
        <NavLink to="/vehicles" style={navStyle}>Fleet</NavLink>
      )}
      {hasRole("operator", "supervisor", "manager", "admin") && (
        <NavLink to="/branches" style={navStyle}>Branches</NavLink>
      )}
      {hasRole("admin") && (
        <NavLink to="/ml-config" style={navStyle}>ML Config</NavLink>
      )}

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: isMobile ? 8 : 14 }}>
        {isMobile ? (
          <span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600 }}>{user.username}</span>
        ) : (
          <span style={{ fontSize: 13, color: "#94a3b8" }}>
            <strong style={{ color: "#e2e8f0" }}>{user.username}</strong>
            {" · "}
            <span style={{ color: "#64748b", background: "#0f2744", padding: "2px 8px", borderRadius: 10, fontSize: 11 }}>
              {ROLE_LABELS[user.role]}
            </span>
          </span>
        )}
        <button onClick={logout}
          style={{ background: "none", border: "1px solid #334155", color: "#94a3b8", borderRadius: 6, padding: isMobile ? "4px 8px" : "4px 12px", cursor: "pointer", fontSize: isMobile ? 12 : 13 }}>
          {isMobile ? "✕" : "Sign out"}
        </button>
      </div>
    </nav>
  );
}

function DriverNav() {
  const { user, logout } = useAuth();
  const isMobile = useIsMobile();
  if (!user) return null;

  return (
    <nav style={{
      background: "#1e3a5f", color: "#fff",
      padding: isMobile ? "8px 12px" : "0 24px",
      display: "flex", alignItems: "center",
      gap: isMobile ? 10 : 24,
      minHeight: 52,
    }}>
      <span style={{ fontWeight: 800, fontSize: isMobile ? 15 : 17, letterSpacing: 1 }}>LogiTrack</span>
      <NavLink to="/driver/route" style={navStyle}>Mi ruta</NavLink>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: isMobile ? 8 : 14 }}>
        {isMobile ? (
          <span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600 }}>{user.username}</span>
        ) : (
          <span style={{ fontSize: 13, color: "#94a3b8" }}>
            <strong style={{ color: "#e2e8f0" }}>{user.username}</strong>
            {" · "}
            <span style={{ color: "#64748b", background: "#0f2744", padding: "2px 8px", borderRadius: 10, fontSize: 11 }}>
              Chofer
            </span>
          </span>
        )}
        <button onClick={logout}
          style={{ background: "none", border: "1px solid #334155", color: "#94a3b8", borderRadius: 6, padding: isMobile ? "4px 8px" : "4px 12px", cursor: "pointer", fontSize: isMobile ? 12 : 13 }}>
          {isMobile ? "✕" : "Sign out"}
        </button>
      </div>
    </nav>
  );
}

function AppRoutes() {
  const { user } = useAuth();

  if (user?.role === "driver") {
    return (
      <>
        <DriverNav />
        <main>
          <Routes>
            <Route path="/driver/route" element={
              <ProtectedRoute roles={["driver"]}>
                <DriverRoute />
              </ProtectedRoute>
            } />
            <Route path="/shipments/:trackingId" element={
              <ProtectedRoute roles={["driver"]}>
                <DriverShipmentDetail />
              </ProtectedRoute>
            } />
            <Route path="*" element={<Navigate to="/driver/route" replace />} />
          </Routes>
        </main>
      </>
    );
  }

  return (
    <>
      <Nav />
      <main>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />

          <Route path="/dashboard" element={
            <ProtectedRoute roles={["supervisor", "manager", "admin"]}>
              <Dashboard />
            </ProtectedRoute>
          } />

          <Route path="/" element={
            <ProtectedRoute>
              <ShipmentList />
            </ProtectedRoute>
          } />

          <Route path="/shipments/:trackingId" element={
            <ProtectedRoute>
              <ShipmentDetail />
            </ProtectedRoute>
          } />

          <Route path="/new" element={
            <ProtectedRoute roles={["operator", "supervisor", "admin"]}>
              <NewShipment />
            </ProtectedRoute>
          } />

          <Route path="/track" element={
            <ProtectedRoute>
              <PublicTracking />
            </ProtectedRoute>
          } />

          <Route path="/vehicles" element={
            <ProtectedRoute roles={["supervisor", "manager", "admin"]}>
              <VehicleList />
            </ProtectedRoute>
          } />

          <Route path="/branches" element={
            <ProtectedRoute roles={["operator", "supervisor", "manager", "admin"]}>
              <BranchList />
            </ProtectedRoute>
          } />

          <Route path="/ml-config" element={
            <ProtectedRoute roles={["admin"]}>
              <MLConfig />
            </ProtectedRoute>
          } />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

const navStyle = ({ isActive }: { isActive: boolean }): React.CSSProperties => ({
  color: isActive ? "#93c5fd" : "#cbd5e1",
  textDecoration: "none",
  fontWeight: 500,
  fontSize: 14,
});
