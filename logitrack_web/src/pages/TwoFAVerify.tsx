import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { twoFAApi } from '../api/two-fa';
import { useAuth } from '../context/AuthContext';
import { AlertCircle, Shield, Clock } from 'lucide-react';

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

export const TwoFAVerify: React.FC = () => {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Intentos: ref + state para evitar problemas con closures y batching
  const attemptsRef = useRef(MAX_ATTEMPTS);
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_ATTEMPTS);

  // Lockout: timestamp absoluto en un ref, countdown en state actualizado por ticker
  const lockoutUntilRef = useRef(0);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);

  const navigate = useNavigate();
  const location = useLocation();
  const { setSession } = useAuth();

  const sessionToken = location.state?.session_token;

  useEffect(() => {
    if (!sessionToken) navigate('/login');
  }, [sessionToken, navigate]);

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

  const handleVerify = async () => {
    if (code.length !== 6 || isLocked || loading) return;

    setLoading(true);
    setError('');

    try {
      const response = await twoFAApi.verify({ session_token: sessionToken, code });
      setSession(response.token, response.user);

      const { role, driver_type } = response.user;
      if (role === 'driver') {
        navigate(driver_type === 'intersucursal' ? '/driver/scan' : '/driver/route', { replace: true });
      } else if (role === 'admin') {
        navigate('/admin/users', { replace: true });
      } else if (role === 'manager' || role === 'supervisor') {
        navigate('/dashboard', { replace: true });
      } else {
        navigate('/', { replace: true });
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-lg max-w-sm w-full border border-gray-200 dark:border-gray-700">

        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Shield className="w-7 h-7 text-blue-600 dark:text-blue-400" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Verificación de seguridad</h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1.5 text-sm">
            Ingresá el código de 6 dígitos de tu app autenticadora
          </p>
        </div>

        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
          placeholder="000000"
          className="w-full text-center text-3xl tracking-widest border-2 rounded-xl p-4 mb-4 focus:border-blue-500 focus:outline-none disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:text-gray-400 dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100 transition-colors"
          maxLength={6}
          autoFocus
          disabled={isLocked || loading}
        />

        {/* Intentos restantes */}
        {!isLocked && attemptsLeft < MAX_ATTEMPTS && attemptsLeft > 0 && (
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 mb-3 px-1">
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
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 mb-4">
            <Clock className="w-4 h-4 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-700 dark:text-red-400">Acceso bloqueado temporalmente</p>
              <p className="text-sm text-red-600 dark:text-red-500 mt-0.5">
                Podés reintentar en{' '}
                <span className="font-mono font-bold">{formatCountdown(lockoutRemaining)}</span>
              </p>
            </div>
          </div>
        )}

        {/* Error de código incorrecto */}
        {error && !isLocked && (
          <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 mb-4">
            <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400 shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-400">Código incorrecto. Verificá tu app autenticadora.</p>
          </div>
        )}

        <button
          onClick={handleVerify}
          disabled={loading || code.length !== 6 || isLocked}
          className="w-full bg-blue-600 text-white py-3 rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold text-sm"
        >
          {loading ? 'Verificando...' : 'Verificar'}
        </button>

        <button
          onClick={() => navigate('/login')}
          className="w-full mt-3 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-sm transition-colors"
        >
          ← Volver al inicio de sesión
        </button>

      </div>
    </div>
  );
};
