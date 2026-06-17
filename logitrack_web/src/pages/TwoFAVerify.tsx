import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { twoFAApi } from '../api/two-fa';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Shield, AlertCircle, Clock, Lock } from 'lucide-react';

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

export function TwoFAVerify() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const attemptsRef = useRef(MAX_ATTEMPTS);
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_ATTEMPTS);
  const lockoutUntilRef = useRef(0);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);

  const navigate = useNavigate();
  const location = useLocation();
  const { setSession } = useAuth();

  const sessionToken = location.state?.session_token;

  useEffect(() => {
    if (!sessionToken) navigate('/login');
  }, [sessionToken, navigate]);

  useEffect(() => {
    if (!sessionToken) return;
    const key = `2fa_cooldown_${sessionToken}`;
    const storedCooldown = sessionStorage.getItem(key);
    if (storedCooldown) {
      const cooldownTime = parseInt(storedCooldown, 10);
      if (Date.now() >= cooldownTime) {
        sessionStorage.removeItem(key);
      } else {
        lockoutUntilRef.current = cooldownTime;
        attemptsRef.current = 0;
        setAttemptsLeft(0);
      }
    }
  }, [sessionToken]);

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
          sessionStorage.removeItem(`2fa_cooldown_${sessionToken}`);
        } else {
          setLockoutRemaining(Math.ceil((lockoutUntilRef.current - now) / 1000));
        }
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sessionToken]);

  const isLocked = lockoutRemaining > 0;

  const handleVerify = async () => {
    if (code.length !== 6 || isLocked || loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await twoFAApi.verify({ session_token: sessionToken, code });
      sessionStorage.removeItem("pending_2fa_setup");
      sessionStorage.removeItem("temp_token");
      sessionStorage.removeItem("temp_user");
      sessionStorage.removeItem("2fa_setup_cooldown");
      sessionStorage.removeItem(`2fa_cooldown_${sessionToken}`);
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
      const errorMsg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Error de verificación';
      setCode('');
      if (errorMsg.includes('demasiados intentos')) {
        const match = errorMsg.match(/Esperá (.+?) antes/);
        const secs = match ? parseGoDuration(match[1]) : 60;
        const cooldownTime = Date.now() + secs * 1000;
        lockoutUntilRef.current = cooldownTime;
        sessionStorage.setItem(`2fa_cooldown_${sessionToken}`, cooldownTime.toString());
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
    <div className="min-h-screen bg-gradient-to-br from-[var(--sidebar-bg)] to-slate-900 flex items-center justify-center p-6">
      <Card className="max-w-sm w-full shadow-2xl cursor-default">
        <CardContent className="p-8">
          <div className="text-center mb-6">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[var(--brand)]/10 flex items-center justify-center">
              <Shield className="w-7 h-7 text-[var(--brand)]" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Verificación de seguridad</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1.5">
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
            className="w-full text-center text-3xl tracking-[0.3em] font-mono rounded-xl border-2 border-gray-200 dark:border-gray-600 dark:bg-gray-800 bg-white py-4 dark:text-gray-100 text-gray-900 placeholder:text-gray-300 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:cursor-not-allowed mb-4"
            maxLength={6}
            autoFocus
            disabled={isLocked || loading}
          />

          {!isLocked && attemptsLeft < MAX_ATTEMPTS && attemptsLeft > 0 && (
            <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 mb-3 px-1">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>
                {attemptsLeft === 1 ? 'Último intento antes del bloqueo' : `${attemptsLeft} intentos restantes`}
              </span>
            </div>
          )}

          {isLocked && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-3 mb-4">
              <Clock className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-700 dark:text-red-300 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  Bloqueado temporalmente
                </p>
                <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                  Podés reintentar en <span className="font-mono font-bold">{formatCountdown(lockoutRemaining)}</span>
                </p>
              </div>
            </div>
          )}

          {error && !isLocked && (
            <div className="flex items-center gap-2.5 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-3 mb-4">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-300">Código incorrecto. Verificá tu app autenticadora.</p>
            </div>
          )}

          <Button onClick={handleVerify} disabled={loading || code.length !== 6 || isLocked} className="w-full h-11 rounded-xl font-semibold">
            {loading ? 'Verificando...' : 'Verificar'}
          </Button>

          <button onClick={() => navigate('/login')} className="w-full mt-3 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            ← Volver al inicio de sesión
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
