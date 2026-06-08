import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { twoFAApi } from '../api/two-fa';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import type { User } from '../api/auth';
import type { TwoFASetupResponse } from '../types/two-fa';
import { AlertCircle, Clock, Smartphone, AlertTriangle, ShieldCheck, QrCode, Camera } from 'lucide-react';

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

export function TwoFASetup({ required = false }: Props) {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [step, setStep] = useState<'init' | 'scan' | 'confirm' | 'success'>('init');
  const [setupData, setSetupData] = useState<TwoFASetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

  useEffect(() => {
    const storedCooldown = sessionStorage.getItem('2fa_setup_cooldown');
    if (storedCooldown) {
      const cooldownTime = parseInt(storedCooldown, 10);
      if (Date.now() >= cooldownTime) {
        sessionStorage.removeItem('2fa_setup_cooldown');
      } else {
        lockoutUntilRef.current = cooldownTime;
        attemptsRef.current = 0;
        setAttemptsLeft(0);
      }
    }
  }, []);

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
          sessionStorage.removeItem('2fa_setup_cooldown');
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
      const errorMsg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Error al iniciar configuración';
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
      const errorMsg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Error de verificación';
      setCode('');
      if (errorMsg.includes('demasiados intentos')) {
        const match = errorMsg.match(/Esperá (.+?) antes/);
        const secs = match ? parseGoDuration(match[1]) : 60;
        const cooldownTime = Date.now() + secs * 1000;
        lockoutUntilRef.current = cooldownTime;
        sessionStorage.setItem('2fa_setup_cooldown', cooldownTime.toString());
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
      <Card className="max-w-lg w-full shadow-2xl cursor-default">
        <CardContent className="p-8">
          <div className="text-center mb-6">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[var(--brand)]/10 flex items-center justify-center">
              <ShieldCheck className="w-7 h-7 text-[var(--brand)]" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {required ? 'Seguridad Requerida' : 'Autenticación de Doble Factor'}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1.5">
              {required ? 'Debés activar 2FA para continuar' : 'Agregá una capa extra de seguridad a tu cuenta'}
            </p>
          </div>

          {/* Step 1 */}
          {step === 'init' && (
            <div className="space-y-5">
              <div className="rounded-xl border border-[var(--brand-tint-border)] bg-[var(--brand-tint)] dark:bg-[var(--brand)]/10 p-5">
                <h3 className="font-semibold text-sm text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-[var(--brand)]" /> ¿Qué necesitás?
                </h3>
                <ul className="space-y-2">
                  <li className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                    <Smartphone className="w-4 h-4 text-[var(--brand)] shrink-0" />
                    Tu teléfono
                  </li>
                  <li className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                    <QrCode className="w-4 h-4 text-[var(--brand)] shrink-0" />
                    Google Authenticator instalado
                  </li>
                  <li className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                    <Camera className="w-4 h-4 text-[var(--brand)] shrink-0" />
                    Acceso a la cámara para escanear QR
                  </li>
                </ul>
              </div>

              {error && (
                <div className="flex items-center gap-2.5 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-3">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                </div>
              )}

              <Button onClick={handleInitSetup} disabled={loading} className="w-full h-11 rounded-xl font-semibold">
                {loading ? 'Generando...' : required ? 'Continuar con la Activación' : 'Activar Autenticación de Doble Factor'}
              </Button>

              {!required && (
                <button onClick={() => navigate('/profile')} className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                  ← Volver al perfil
                </button>
              )}
            </div>
          )}

          {/* Step 2 */}
          {step === 'scan' && setupData && (
            <div className="space-y-6">
              <div className="text-center">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
                  Escaneá este código QR
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Abrí Google Authenticator y escaneá el código
                </p>
              </div>

              <div className="flex justify-center">
                <img src={setupData.qr_code_url} alt="QR Code 2FA" className="w-64 h-64 rounded-xl border border-gray-200 dark:border-gray-700" />
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
            </div>
          )}

          {/* Step 3 */}
          {step === 'confirm' && (
            <div className="space-y-5">
              <div className="text-center">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
                  Ingresá el código
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  El código de 6 dígitos de Google Authenticator
                </p>
              </div>

              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
                placeholder="000000"
                className="w-full text-center text-3xl tracking-[0.3em] font-mono rounded-xl border-2 border-gray-200 dark:border-gray-600 dark:bg-gray-800 bg-white py-4 dark:text-gray-100 text-gray-900 placeholder:text-gray-300 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:cursor-not-allowed"
                maxLength={6}
                autoFocus
                disabled={isLocked || loading}
              />

              {!isLocked && attemptsLeft < MAX_ATTEMPTS && attemptsLeft > 0 && (
                <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 px-1">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{attemptsLeft === 1 ? 'Último intento' : `${attemptsLeft} intentos restantes`}</span>
                </div>
              )}

              {isLocked && (
                <div className="flex items-start gap-2.5 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-3">
                  <Clock className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-red-700 dark:text-red-300">Bloqueado temporalmente</p>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                      Podés reintentar en <span className="font-mono font-bold">{formatCountdown(lockoutRemaining)}</span>
                    </p>
                  </div>
                </div>
              )}

              {error && !isLocked && (
                <div className="flex items-center gap-2.5 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-3">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <p className="text-sm text-red-700 dark:text-red-300">Código incorrecto. Verificá tu app.</p>
                </div>
              )}

              <Button onClick={handleConfirm} disabled={loading || code.length !== 6 || isLocked} className="w-full h-11 rounded-xl font-semibold">
                {loading ? 'Verificando...' : 'Confirmar Activación'}
              </Button>
            </div>
          )}

          {/* Step 4: Success */}
          {step === 'success' && (
            <div className="text-center py-4">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center">
                <ShieldCheck className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">¡Listo!</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                La autenticación de doble factor está activada.
              </p>
              <Button onClick={() => navigate('/profile')} className="rounded-xl">
                Ir a mi perfil
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
