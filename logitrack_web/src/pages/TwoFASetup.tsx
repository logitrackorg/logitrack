import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { twoFAApi } from '../api/two-fa';
import { useAuth } from '../context/AuthContext';
import type { User } from '../api/auth';
import type { TwoFASetupResponse } from '../types/two-fa';
import { AlertCircle, Clock } from 'lucide-react';

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
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold mb-2">📱 ¿Qué necesitas?</h3>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>Tu teléfono corporativo</li>
              <li>Google Authenticator instalado</li>
              <li>Acceso a la cámara para escanear QR</li>
            </ul>
          </div>

          <button
            onClick={handleInitSetup}
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Iniciando...' : 'Activar Autenticación de Doble Factor'}
          </button>
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

            <div className="bg-gray-50 p-4 rounded border">
              <p className="text-sm font-medium mb-2">
                ⚠️ Clave de respaldo (anótala en lugar seguro):
              </p>
              <code className="block bg-white p-2 rounded border text-sm break-all">
                {setupData.secret}
              </code>
            </div>
          </div>

          <button
            onClick={() => setStep('confirm')}
            className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700"
          >
            Ya escaneé el código →
          </button>
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

            <button
              onClick={handleConfirm}
              disabled={loading || code.length !== 6 || isLocked}
              className="w-full bg-green-600 text-white py-3 rounded-xl hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
            >
              {loading ? 'Verificando...' : 'Confirmar Activación'}
            </button>
          </div>
        </div>
      )}

      {/* Paso 4: Éxito */}
      {step === 'success' && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <div className="text-5xl mb-4">✅</div>
          <h3 className="text-xl font-bold mb-2">
            ¡Autenticación de Doble Factor Activada!
          </h3>
          <p className="text-gray-700 mb-4">
            A partir de ahora, necesitarás tu código de 6 dígitos cada vez que inicies sesión.
          </p>
          <button
            onClick={() => window.location.href = '/profile'}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
          >
            Volver a Mi Perfil
          </button>
        </div>
      )}
    </div>
  );
};
