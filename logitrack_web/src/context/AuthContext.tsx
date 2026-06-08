import { createContext, useContext, useState, type ReactNode } from "react";
import { authApi, type User, type Role } from "@/api/auth";

interface AuthContextValue {
  user: User | null;
  token: string | null;
  logout: () => void;
  hasRole: (...roles: Role[]) => boolean;
  setSession: (token: string, user: User) => void;
  setUser: (user: User | null) => void; 
  setToken: (token: string | null) => void; 
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("token"));
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem("user");
    return stored ? (JSON.parse(stored) as User) : null;
  });

  const logout = () => {
    if (token) authApi.logout(token);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    sessionStorage.removeItem("shipment_status_filter");
    setToken(null);
    setUser(null);
  };

  const hasRole = (...roles: Role[]) => {
    return user ? roles.includes(user.role) : false;
  };

  const setSession = (newToken: string, newUser: User) => {
    localStorage.setItem("token", newToken);
    localStorage.setItem("user", JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  return (
    <AuthContext.Provider value={{ user, token, logout, hasRole, setSession, setUser, setToken  }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
