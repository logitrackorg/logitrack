import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { twoFAApi } from '../api/two-fa';
import { systemConfigApi } from '../api/systemConfig';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { AlertBanner } from '../components/ui/alert-banner';
import { Lock, Smartphone, QrCode, Camera, AlertTriangle, ShieldCheck } from 'lucide-react';
import type { TwoFASetupResponse } from '../types/two-fa';

function formatCooldown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

export function TwoFASetupRequired() {
  const navigate = useNavigate();
  const { setSession, logout } = useAuth();
  const [step, setStep] = useState<'init' | 'scan' | 'confirm' | 'success'>('init');
  const [setupData, setSetupData] = useState<TwoFASetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [cooldownMinutes, setCooldownMinutes] = useState(1);

  useEffect(() => {
    let cancelled = false;
    const loadCooldownConfig = async () => {
      try {
        const config = await systemConfigApi.getPublicConfig();
        if (!cancelled) setCooldownMinutes(config.two_fa_cooldown_minutes);
      } catch {
        if (!cancelled) setCooldownMinutes(1);
      }
    };
    loadCooldownConfig();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const storedCooldown = sessionStorage.getItem('2fa_cooldown_until');
    const storedAttempts = sessionStorage.getItem('2fa_attempts');
    if (storedCooldown) {
      const cooldownTime = parseInt(storedCooldown, 10);
      if (Date.now() < cooldownTime) {
        setCooldownUntil(cooldownTime);
        setAttempts(parseInt(storedAttempts || '3', 10));
      } else {
        sessionStorage.removeItem('2fa_cooldown_until');
        sessionStorage.removeItem('2fa_attempts');
      }
    }
  }, []);

  useEffect(() => {
    const isPending = sessionStorage.getItem("pending_2fa_setup");
    const tempToken = sessionStorage.getItem("temp_token");
    const tempUser = sessionStorage.getItem("temp_user");
    if (isPending !== "true" || !tempToken || !tempUser) {
      sessionStorage.clear();
      logout();
      navigate('/login', { replace: true });
      return;
    }
    try {
      const user = JSON.parse(tempUser);
      const requiresRoles = ['admin', 'manager', 'supervisor', 'operator'];
      if (!requiresRoles.includes(user.role)) {
        sessionStorage.clear();
        navigate('/login', { replace: true });
        return;
      }
      if (user.two_fa_enabled) {
        sessionStorage.clear();
        setSession(tempToken, user);
        navigate('/', { replace: true });
        return;
      }
    } catch {
      sessionStorage.clear();
      logout();
      navigate('/login', { replace: true });
    }
  }, [navigate, logout, setSession]);

  useEffect(() => {
    if (!cooldownUntil) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const remaining = Math.ceil((cooldownUntil - now) / 1000);
      if (remaining <= 0) {
        setCooldownUntil(null);
        setCooldownSeconds(0);
        setAttempts(0);
        sessionStorage.removeItem('2fa_cooldown_until');
        sessionStorage.removeItem('2fa_attempts');
      } else {
        setCooldownSeconds(remaining);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldownUntil]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (step !== 'success') { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [step]);

  const handleInitSetup = async () => {
    const storedCooldown = sessionStorage.getItem('2fa_cooldown_until');
    if (storedCooldown) {
      const cooldownTime = parseInt(storedCooldown, 10);
      if (Date.now() < cooldownTime) {
        setError(`Tienes un bloqueo activo. Espera ${Math.ceil((cooldownTime - Date.now()) / 1000)} segundos.`);
        return;
      }
    }
    setLoading(true);
    setError('');
    try {
      const tempToken = sessionStorage.getItem("temp_token");
      if (!tempToken) throw new Error('Token no disponible');
      const data = await twoFAApi.setup();
      setSetupData(data);
      setStep('scan');
      if (!cooldownUntil) {
        setAttempts(0);
        setCooldownUntil(null);
        sessionStorage.removeItem('2fa_cooldown_until');
        sessionStorage.removeItem('2fa_attempts');
      }
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Error al iniciar configuración';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (code.length !== 6) { setError('El código debe tener 6 dígitos'); return; }
    if (cooldownUntil && Date.now() < cooldownUntil) {
      setError(`Demasiados intentos. Espera ${cooldownSeconds} segundos.`);
      return;
    }
    setLoading(true);
    setError('');
    try {
      await twoFAApi.confirm({ code });
      const tempToken = sessionStorage.getItem("temp_token");
      const tempUserStr = sessionStorage.getItem("temp_user");
      if (!tempToken || !tempUserStr) throw new Error('Datos de sesión no disponibles');
      const user = JSON.parse(tempUserStr);
      user.two_fa_enabled = true;
      user.two_fa_enrolled_at = new Date().toISOString();
      sessionStorage.clear();
      setSession(tempToken, user);
      setStep('success');
      setAttempts(0);
      setCooldownUntil(null);
      setTimeout(() => navigate('/', { replace: true }), 2000);
    } catch {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      if (newAttempts >= 3) {
        const cooldownMs = cooldownMinutes * 60 * 1000;
        const cooldownTime = Date.now() + cooldownMs;
        setCooldownUntil(cooldownTime);
        setCooldownSeconds(cooldownMinutes * 60);
        sessionStorage.setItem('2fa_cooldown_until', cooldownTime.toString());
        sessionStorage.setItem('2fa_attempts', newAttempts.toString());
        setError(`Código incorrecto. Has fallado ${newAttempts} veces. Espera ${cooldownMinutes} ${cooldownMinutes === 1 ? 'minuto' : 'minutos'} antes de reintentar.`);
      } else {
        setError(`Código incorrecto. Intento ${newAttempts} de 3.`);
      }
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    sessionStorage.clear();
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[var(--sidebar-bg)] to-slate-900 flex items-center justify-center p-6">
      <Card className="max-w-2xl w-full shadow-2xl overflow-hidden cursor-default">
        <CardContent className="p-8">

          {/* Step 1: Init */}
          {step === 'init' && (
            <div className="space-y-5">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[var(--brand)]/10 flex items-center justify-center">
                  <Lock className="w-8 h-8 text-[var(--brand)]" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
                  Seguridad Requerida
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Debés activar la autenticación de doble factor para continuar
                </p>
              </div>

              <div className="rounded-xl border border-[var(--brand-tint-border)] bg-[var(--brand-tint)] dark:bg-[var(--brand)]/10 p-5">
                <h3 className="font-semibold text-sm text-gray-800 dark:text-gray-200 mb-3">¿Qué necesitás?</h3>
                <ul className="space-y-2.5">
                  <li className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                    <Smartphone className="w-5 h-5 text-[var(--brand)] shrink-0" />
                    Tu teléfono
                  </li>
                  <li className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                    <QrCode className="w-5 h-5 text-[var(--brand)] shrink-0" />
                    Google Authenticator instalado
                  </li>
                  <li className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                    <Camera className="w-5 h-5 text-[var(--brand)] shrink-0" />
                    Acceso a la cámara para escanear QR
                  </li>
                </ul>
              </div>

              {error && (
                <AlertBanner variant="danger" title="Error" description={error} onDismiss={() => setError('')} />
              )}

              <Button onClick={handleInitSetup} disabled={loading} className="w-full h-12 rounded-xl text-base font-semibold">
                {loading ? 'Generando...' : 'Continuar con la Activación'}
              </Button>

              <button onClick={handleCancel} className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                ← Volver al login
              </button>
            </div>
          )}

          {/* Step 2: Scan QR */}
          {step === 'scan' && setupData && (
            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">
                  Escaneá este código QR
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Abrí Google Authenticator y escaneá el código
                </p>
              </div>

              <div className="flex justify-center">
                <img
                  src={setupData.qr_code_url}
                  alt="QR Code 2FA"
                  className="w-64 h-64 rounded-xl border border-gray-200 dark:border-gray-700"
                />
              </div>

              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  Clave de respaldo (anotala en un lugar seguro):
                </p>
                <code className="block bg-white dark:bg-gray-800 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm break-all font-mono text-gray-900 dark:text-gray-100">
                  {setupData.secret}
                </code>
              </div>

              <Button onClick={() => setStep('confirm')} className="w-full h-11 rounded-xl font-semibold">
                Ya escaneé el código
              </Button>

              <button onClick={handleCancel} className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                ← Cancelar
              </button>
            </div>
          )}

          {/* Step 3: Confirm code */}
          {step === 'confirm' && (
            <div className="space-y-5">
              <div className="text-center">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">
                  Ingresá el código
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  El código de 6 dígitos de Google Authenticator
                </p>
              </div>

              {attempts > 0 && !cooldownUntil && (
                <AlertBanner variant="warning" title={`Intentos: ${attempts}/3`} />
              )}

              {cooldownUntil && (
                <div className="rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 p-4 text-center">
                  <p className="text-sm font-semibold text-red-700 dark:text-red-300 flex items-center justify-center gap-1.5">
                    <Lock className="w-4 h-4" />
                    Bloqueado temporalmente
                  </p>
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                    Esperá {formatCooldown(cooldownSeconds)}
                  </p>
                </div>
              )}

              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                disabled={!!cooldownUntil}
                className="w-full text-center text-3xl tracking-[0.3em] font-mono rounded-xl border-2 border-gray-200 dark:border-gray-600 dark:bg-gray-800 bg-white py-4 dark:text-gray-100 text-gray-900 placeholder:text-gray-300 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:cursor-not-allowed"
                maxLength={6}
                autoFocus
              />

              {error && (
                <AlertBanner variant="danger" description={error} onDismiss={() => setError('')} />
              )}

              <Button
                onClick={handleConfirm}
                disabled={loading || code.length !== 6 || !!cooldownUntil}
                className="w-full h-12 rounded-xl text-base font-semibold"
              >
                {loading ? 'Verificando...' : 'Confirmar Activación'}
              </Button>

              <button onClick={handleCancel} disabled={loading} className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                ← Cancelar
              </button>
            </div>
          )}

          {/* Step 4: Success */}
          {step === 'success' && (
            <div className="text-center py-4">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center">
                <ShieldCheck className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">¡Listo!</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                La autenticación de doble factor está activada.
                <br />
                Redirigiendo...
              </p>
            </div>
          )}

        </CardContent>
      </Card>
    </div>
  );
};
