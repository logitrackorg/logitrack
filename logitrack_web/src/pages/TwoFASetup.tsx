import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { twoFAApi } from '../api/two-fa';
import { useAuth } from '../context/AuthContext';
import type { User } from '../api/auth';
import type { TwoFASetupResponse } from '../types/two-fa';
import { AlertCircle, Clock, Smartphone, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Button } from '../components/ui/button';

const MAX_ATTEMPTS = 3;

function parseGoDuration(s: string): number {
  let seconds = 0;
  const minMatch = s.match(/(\d+)m/);
  const secMatch = s.match(/(\d+)s/);
  if (minMatch) seconds += parseInt(minMatch[1]) * 60;
  if (secMatch) seconds += parseInt(secMatch[1]);
  return seconds;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

interface Props {
  required?: boolean;
}

export const TwoFASetup: React.FC<Props> = ({ required = false }) => {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [step, setStep] = useState<'init' | 'scan' | 'confirm' | 'success'>('init');
  const [setupData, setSetupData] = useState<TwoFASetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Intentos y lockout — mismo patrón que TwoFAVerify
  const attemptsRef = useRef(MAX_ATTEMPTS);
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_ATTEMPTS);
  const lockoutUntilRef = useRef(0);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);

  useEffect(() => {
    if (!required) return;
    if (!sessionStorage.getItem("pending_2fa_setup")) {
      navigate('/login', { replace: true });
    }
  }, [required, navigate]);

  // Ticker global: actualiza countdown cada segundo y limpia el lockout al expirar
  useEffect(() => {
    const tick = () => {
      if (lockoutUntilRef.current > 0) {
        const now = Date.now();
        if (now >= lockoutUntilRef.current) {
          lockoutUntilRef.current = 0;
          setLockoutRemaining(0);
          setError('');
          attemptsRef.current = MAX_ATTEMPTS;
          setAttemptsLeft(MAX_ATTEMPTS);
        } else {
          setLockoutRemaining(Math.ceil((lockoutUntilRef.current - now) / 1000));
        }
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const isLocked = lockoutRemaining > 0;

  const handleInitSetup = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await twoFAApi.setup();
      setSetupData(data);
      setStep('scan');
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error || 'Error al iniciar configuración';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (code.length !== 6 || isLocked) return;

    setLoading(true);
    setError('');
    try {
      await twoFAApi.confirm({ code });

      if (required) {
        const tempToken = sessionStorage.getItem("temp_token");
        const tempUserStr = sessionStorage.getItem("temp_user");
        if (tempToken && tempUserStr) {
          const tempUser: User = JSON.parse(tempUserStr);
          setSession(tempToken, { ...tempUser, two_fa_enabled: true });
          sessionStorage.removeItem("pending_2fa_setup");
          sessionStorage.removeItem("temp_token");
          sessionStorage.removeItem("temp_user");

          if (tempUser.role === "admin") {
            navigate("/admin/users", { replace: true });
          } else if (tempUser.role === "manager" || tempUser.role === "supervisor") {
            navigate("/dashboard", { replace: true });
          } else {
            navigate("/", { replace: true });
          }
        } else {
          navigate("/login", { replace: true });
        }
      } else {
        setStep('success');
      }
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error || 'Error de verificación';

      setCode('');

      if (errorMsg.includes('demasiados intentos')) {
        const match = errorMsg.match(/Esperá (.+?) antes/);
        const secs = match ? parseGoDuration(match[1]) : 60;
        lockoutUntilRef.current = Date.now() + secs * 1000;
        attemptsRef.current = 0;
        setAttemptsLeft(0);
        setError('');
        setLockoutRemaining(secs);
      } else {
        const newLeft = Math.max(0, attemptsRef.current - 1);
        attemptsRef.current = newLeft;
        setAttemptsLeft(newLeft);
        setError(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">
        Configurar Autenticación de Doble Factor
      </h1>

      {/* Paso 1: Iniciar */}
      {step === 'init' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--brand-tint-border)] bg-[var(--brand-tint)] dark:bg-[var(--brand)]/10 p-5">
            <h3 className="font-semibold text-sm text-gray-800 dark:text-gray-200 mb-2 flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-[var(--brand)]" /> ¿Qué necesitás?
            </h3>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>Tu teléfono corporativo</li>
              <li>Google Authenticator instalado</li>
              <li>Acceso a la cámara para escanear QR</li>
            </ul>
          </div>

          <Button
            onClick={handleInitSetup}
            disabled={loading}
            className="w-full h-11 rounded-xl"
          >
            {loading ? 'Iniciando...' : 'Activar Autenticación de Doble Factor'}
          </Button>
        </div>
      )}

      {/* Paso 2: Escanear QR */}
      {step === 'scan' && setupData && (
        <div className="space-y-6">
          <div className="bg-white border rounded-lg p-6">
            <h3 className="font-semibold mb-4 text-center">
              Escanea este código QR con Google Authenticator
            </h3>

            <div className="flex justify-center mb-4">
              <img
                src={setupData.qr_code_url}
                alt="QR Code 2FA"
                className="w-64 h-64"
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
          </div>

          <Button onClick={() => setStep('confirm')} className="w-full h-11 rounded-xl font-semibold">
            Ya escaneé el código
          </Button>
        </div>
      )}

      {/* Paso 3: Confirmar código */}
      {step === 'confirm' && (
        <div className="space-y-4">
          <div className="bg-white border rounded-lg p-6 space-y-4">
            <h3 className="font-semibold">
              Ingresá el código de 6 dígitos de tu app
            </h3>

            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
              placeholder="000000"
              className="w-full text-center text-3xl tracking-widest border-2 rounded-xl p-4 focus:border-blue-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400 transition-colors"
              maxLength={6}
              autoFocus
              disabled={isLocked || loading}
            />

            {/* Intentos restantes */}
            {!isLocked && attemptsLeft < MAX_ATTEMPTS && attemptsLeft > 0 && (
              <div className="flex items-center gap-2 text-sm text-amber-600">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>
                  {attemptsLeft === 1
                    ? 'Último intento antes del bloqueo temporal'
                    : `${attemptsLeft} intentos restantes antes del bloqueo`}
                </span>
              </div>
            )}

            {/* Bloqueo con cuenta regresiva */}
            {isLocked && (
              <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <Clock className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-700">Acceso bloqueado temporalmente</p>
                  <p className="text-sm text-red-600 mt-0.5">
                    Podés reintentar en{' '}
                    <span className="font-mono font-bold">{formatCountdown(lockoutRemaining)}</span>
                  </p>
                </div>
              </div>
            )}

            {/* Error de código incorrecto */}
            {error && !isLocked && (
              <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                <p className="text-sm text-red-700">Código incorrecto. Verificá tu app autenticadora.</p>
              </div>
            )}

              <Button onClick={handleConfirm} disabled={loading || code.length !== 6 || isLocked} className="w-full h-11 rounded-xl font-semibold">
                {loading ? 'Verificando...' : 'Confirmar Activación'}
              </Button>
          </div>
        </div>
      )}

      {/* Paso 4: Éxito */}
      {step === 'success' && (
        <div className="rounded-xl border border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10 p-6 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center">
            <ShieldCheck className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h3 className="text-xl font-bold mb-2">
            ¡Autenticación de Doble Factor Activada!
          </h3>
          <p className="text-gray-700 mb-4">
            A partir de ahora, necesitarás tu código de 6 dígitos cada vez que inicies sesión.
          </p>
          <Button onClick={() => window.location.href = '/profile'} variant="default" className="rounded-xl">
            Ir a mi perfil
          </Button>
        </div>
      )}
    </div>
  );
};
