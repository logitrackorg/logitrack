import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import { ToastContainer } from "./components/Toast";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { useIsMobile } from "./hooks/useIsMobile";
import { Layout } from "./components/Layout";
import { Truck, LogOut, Route as RouteIcon } from "lucide-react";
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
import { SystemConfig } from "./pages/SystemConfig";
import { OrganizationConfig } from "./pages/OrganizationConfig";
import { AdminUsers } from "./pages/AdminUsers";
import { BulkUpload } from "./pages/BulkUpload";
import { AccessLog } from "./pages/AccessLog";
import { UserProfile } from "./pages/UserProfile";

const ROLE_STYLES: Record<string, string> = {
  operator: "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30",
  supervisor: "bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/30",
  manager: "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30",
  admin: "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/30",
  driver: "bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/30",
};

function NavItem({
  to,
  icon: Icon,
  label,
  end,
}: {
  to: string;
  icon: React.ElementType;
  label: string;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          isActive ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
        }`
      }>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </NavLink>
  );
}

function DriverNav() {
  const { user, logout } = useAuth();
  const isMobile = useIsMobile();
  if (!user) return null;

  return (
    <nav className="bg-[#1e3a5f] border-b border-white/10 px-4 flex items-center gap-2 min-h-13">
      <div className="flex items-center gap-2 mr-3">
        <div className="w-7 h-7 bg-[#f97316] rounded-lg flex items-center justify-center shadow-sm shadow-orange-500/30">
          <Truck className="w-4 h-4 text-white" />
        </div>
        {!isMobile && <span className="font-bold text-white text-sm tracking-tight">LogiTrack</span>}
      </div>
      <div className="w-px h-5 bg-white/10 mr-1" />
      <NavItem to="/driver/route" icon={RouteIcon} label="Mi ruta" />
      <div className="ml-auto flex items-center gap-2">
        <div className="flex items-center gap-2 px-2">
          <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center">
            <span className="text-[10px] font-bold text-white uppercase">{user.username[0]}</span>
          </div>
          {!isMobile && (
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-slate-200">{user.username}</span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${ROLE_STYLES["driver"]}`}>
                Chofer
              </span>
            </div>
          )}
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors text-sm"
          title="Cerrar sesión">
          <LogOut className="w-3.5 h-3.5" />
          {!isMobile && "Salir"}
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
        <main className="min-h-screen bg-slate-50">
          <Routes>
            <Route
              path="/driver/route"
              element={
                <ProtectedRoute roles={["driver"]}>
                  <DriverRoute />
                </ProtectedRoute>
              }
            />
            <Route
              path="/shipments/:trackingId"
              element={
                <ProtectedRoute roles={["driver"]}>
                  <DriverShipmentDetail />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/driver/route" replace />} />
          </Routes>
        </main>
      </>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to={user.role === "admin" ? "/admin/users" : "/"} replace /> : <Login />}
      />
      <Route
        path="*"
        element={
          <Layout>
            <Routes>
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute roles={["supervisor", "manager"]}>
                    <Dashboard />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/"
                element={
                  <ProtectedRoute roles={["operator", "supervisor", "manager"]}>
                    <ShipmentList />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/shipments/:trackingId"
                element={
                  <ProtectedRoute>
                    <ShipmentDetail />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/new"
                element={
                  <ProtectedRoute roles={["operator", "supervisor", "admin"]}>
                    <NewShipment />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/vehicles"
                element={
                  <ProtectedRoute roles={["operator", "supervisor", "manager", "admin"]}>
                    <VehicleList />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/branches"
                element={
                  <ProtectedRoute roles={["supervisor", "manager", "admin"]}>
                    <BranchList />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/ml-config"
                element={
                  <ProtectedRoute roles={["admin"]}>
                    <MLConfig />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/system-config"
                element={
                  <ProtectedRoute roles={["admin"]}>
                    <SystemConfig />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/organization"
                element={
                  <ProtectedRoute roles={["admin"]}>
                    <OrganizationConfig />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/admin/users"
                element={
                  <ProtectedRoute roles={["admin"]}>
                    <AdminUsers />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/bulk-upload"
                element={
                  <ProtectedRoute roles={["operator", "supervisor"]}>
                    <BulkUpload />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/admin/access-logs"
                element={
                  <ProtectedRoute roles={["admin"]}>
                    <AccessLog />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <UserProfile />
                  </ProtectedRoute>
                }
              />

              <Route path="*" element={<Navigate to={user?.role === "admin" ? "/admin/users" : "/"} replace />} />
            </Routes>
          </Layout>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/track" element={<PublicTracking />} />
          <Route path="*" element={<AppRoutes />} />
        </Routes>
        <ToastContainer />
      </BrowserRouter>
    </AuthProvider>
  );
}
