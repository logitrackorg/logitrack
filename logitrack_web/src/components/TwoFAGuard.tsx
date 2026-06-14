import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

const ALLOWED_PATHS = [
  '/login',
  '/2fa/verify',
  '/2fa/setup-required',
  '/2fa/setup',
  '/profile/2fa/setup',
  '/track'
];

export function TwoFAGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Si no hay usuario en el context, permitir navegación libre
    if (!user) return;

    // Permitir rutas específicas
    if (ALLOWED_PATHS.some(path => location.pathname.startsWith(path))) {
      return;
    }

    // Roles que requieren 2FA
    const requiresTwoFA = ['admin', 'manager', 'supervisor', 'operator'].includes(user.role);

    // Si requiere 2FA y NO lo tiene activado
    if (requiresTwoFA && !user.two_fa_enabled) {
      console.log('🚫 Acceso bloqueado: 2FA no configurado');

      // Verificar si hay un setup en progreso
      const isPending = sessionStorage.getItem("pending_2fa_setup");

      if (isPending === "true") {
        // Hay un setup en progreso, permitir acceso a la página de setup
        navigate('/2fa/setup-required', { replace: true });
      } else {
        // No hay setup en progreso, forzar logout
        console.log('❌ No hay setup en progreso - forzando logout');
        sessionStorage.removeItem("pending_2fa_setup");
        sessionStorage.removeItem("temp_token");
        sessionStorage.removeItem("temp_user");
        sessionStorage.removeItem("2fa_setup_cooldown");
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate('/login', { replace: true });
      }
    }
  }, [user, navigate, location.pathname]);

  return <>{children}</>;
}