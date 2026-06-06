// src/pages/TwoFASetupRequired.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { twoFAApi } from '../api/two-fa';
import { systemConfigApi } from '../api/systemConfig';
import { useAuth } from '../context/AuthContext';
import type { TwoFASetupResponse } from '../types/two-fa';

export const TwoFASetupRequired: React.FC = () => {
  const [step, setStep] = useState<'init' | 'scan' | 'confirm' | 'success'>('init');
  const [setupData, setSetupData] = useState<TwoFASetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  // 🔒 Sistema de intentos y cooldown
  const [attempts, setAttempts] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [cooldownMinutes, setCooldownMinutes] = useState(1); // Desde backend

  const navigate = useNavigate();
  const { setSession, logout } = useAuth();

  // 🔄 CARGAR COOLDOWN DESDE BACKEND
  useEffect(() => {
    let cancelled = false;
    
    const loadCooldownConfig = async () => {
      try {
        const config = await systemConfigApi.getPublicConfig();
        if (!cancelled) {
          setCooldownMinutes(config.two_fa_cooldown_minutes);
          console.log('⚙️ Cooldown configurado:', config.two_fa_cooldown_minutes, 'minutos');
        }
      } catch (err) {
        console.error('Error cargando config de cooldown, usando 1 min por defecto');
        if (!cancelled) setCooldownMinutes(1);
      }
    };
    
    loadCooldownConfig();
    
    return () => {
      cancelled = true;
    };
  }, []);

  // 💾 RESTAURAR BLOQUEO TRAS RECARGA
  useEffect(() => {
    const storedCooldown = sessionStorage.getItem('2fa_cooldown_until');
    const storedAttempts = sessionStorage.getItem('2fa_attempts');
    
    if (storedCooldown) {
      const cooldownTime = parseInt(storedCooldown, 10);
      if (Date.now() < cooldownTime) {
        console.log('⚠️ Cooldown activo restaurado desde sessionStorage');
        setCooldownUntil(cooldownTime);
        setAttempts(parseInt(storedAttempts || '3', 10));
      } else {
        // Cooldown expirado, limpiar
        sessionStorage.removeItem('2fa_cooldown_until');
        sessionStorage.removeItem('2fa_attempts');
      }
    }
  }, []);

  // 🔒 VALIDACIÓN DE ACCESO
  useEffect(() => {
    console.log('🔍 Verificando acceso a setup 2FA...');
    
    const isPending = sessionStorage.getItem("pending_2fa_setup");
    const tempToken = sessionStorage.getItem("temp_token");
    const tempUser = sessionStorage.getItem("temp_user");

    // Si NO hay flag de setup pendiente → redirect a login
    if (isPending !== "true" || !tempToken || !tempUser) {
      console.log('❌ Acceso no autorizado - redirigiendo a login');
      sessionStorage.clear();
      logout();
      navigate('/login', { replace: true });
      return;
    }

    try {
      const user = JSON.parse(tempUser);
      console.log('✅ Acceso válido para:', user.username);
      
      // Verificar que el usuario realmente necesita 2FA
      const requiresRoles = ['admin', 'manager', 'supervisor', 'operator'];
      if (!requiresRoles.includes(user.role)) {
        console.log('❌ Usuario no requiere 2FA');
        sessionStorage.clear();
        navigate('/login', { replace: true });
        return;
      }

      // Si ya tiene 2FA activado, completar el login
      if (user.two_fa_enabled) {
        console.log('✅ Usuario ya tiene 2FA - completando login');
        sessionStorage.clear();
        setSession(tempToken, user);
        navigate('/', { replace: true });
        return;
      }

      console.log('✅ Usuario puede configurar 2FA');
      
    } catch (e) {
      console.error('❌ Error validando acceso:', e);
      sessionStorage.clear();
      logout();
      navigate('/login', { replace: true });
    }
  }, [navigate, logout, setSession]);

  // ⏱️ Countdown del cooldown
  useEffect(() => {
    if (!cooldownUntil) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const remaining = Math.ceil((cooldownUntil - now) / 1000);

      if (remaining <= 0) {
        setCooldownUntil(null);
        setCooldownSeconds(0);
        setAttempts(0);
        
        // 🧹 LIMPIAR SESSIONSTORAGE
        sessionStorage.removeItem('2fa_cooldown_until');
        sessionStorage.removeItem('2fa_attempts');
      } else {
        setCooldownSeconds(remaining);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [cooldownUntil]);

  // 🚫 Prevenir recarga accidental
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (step !== 'success') {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [step]);

  const handleInitSetup = async () => {
    // Verificar si hay un cooldown activo
    const storedCooldown = sessionStorage.getItem('2fa_cooldown_until');
    if (storedCooldown) {
      const cooldownTime = parseInt(storedCooldown, 10);
      if (Date.now() < cooldownTime) {
        const remainingSeconds = Math.ceil((cooldownTime - Date.now()) / 1000);
        setError(`Tienes un bloqueo activo. Espera ${remainingSeconds} segundos antes de reintentar.`);
        return;
      }
    }

    setLoading(true);
    setError('');
    
    try {
      console.log('🔵 Generando QR...');
      
      const tempToken = sessionStorage.getItem("temp_token");
      if (!tempToken) {
        throw new Error('Token no disponible');
      }

      const data = await twoFAApi.setup();
      console.log('✅ QR generado');
      setSetupData(data);
      setStep('scan');
      
      // Reset intentos solo si NO hay cooldown activo
      if (!cooldownUntil) {
        setAttempts(0);
        setCooldownUntil(null);
        sessionStorage.removeItem('2fa_cooldown_until');
        sessionStorage.removeItem('2fa_attempts');
      }
      
    } catch (err: unknown) {
      console.error('❌ Error generando QR:', err);
      const errorMsg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error || 'Error al iniciar configuración';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (code.length !== 6) {
      setError('El código debe tener 6 dígitos');
      return;
    }

    // Verificar cooldown
    if (cooldownUntil && Date.now() < cooldownUntil) {
      setError(`Demasiados intentos. Espera ${cooldownSeconds} segundos.`);
      return;
    }

    setLoading(true);
    setError('');

    try {
      console.log('🔵 Confirmando código...');
      await twoFAApi.confirm({ code });
      console.log('✅ 2FA activado exitosamente');

      // Obtener datos del usuario
      const tempToken = sessionStorage.getItem("temp_token");
      const tempUserStr = sessionStorage.getItem("temp_user");

      if (!tempToken || !tempUserStr) {
        throw new Error('Datos de sesión no disponibles');
      }

      const user = JSON.parse(tempUserStr);
      user.two_fa_enabled = true;
      user.two_fa_enrolled_at = new Date().toISOString();

      // 🧹 LIMPIAR SESSION STORAGE
      sessionStorage.clear();

      // ✅ GUARDAR EN CONTEXT Y LOCALSTORAGE
      setSession(tempToken, user);

      setStep('success');
      
      // Reset intentos en caso de éxito
      setAttempts(0);
      setCooldownUntil(null);

      setTimeout(() => {
        console.log('✅ Redirigiendo al dashboard');
        navigate('/', { replace: true });
      }, 2000);
      
    } catch (err: unknown) {
      console.error('❌ Error confirmando código:', err);
      
      // Incrementar intentos
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);

      if (newAttempts >= 3) {
        // Usar el cooldown configurado (en milisegundos)
        const cooldownMs = cooldownMinutes * 60 * 1000;
        const cooldownTime = Date.now() + cooldownMs;
        
        setCooldownUntil(cooldownTime);
        setCooldownSeconds(cooldownMinutes * 60);
        
        // 💾 GUARDAR EN SESSIONSTORAGE PARA PERSISTIR TRAS RECARGA
        sessionStorage.setItem('2fa_cooldown_until', cooldownTime.toString());
        sessionStorage.setItem('2fa_attempts', newAttempts.toString());
        
        setError(`Código incorrecto. Has fallado ${newAttempts} veces. Espera ${cooldownMinutes} ${cooldownMinutes === 1 ? 'minuto' : 'minutos'} antes de reintentar.`);
        setCode('');
      } else {
        setError(`Código incorrecto. Intento ${newAttempts} de 3.`);
        setCode('');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    console.log('🔵 Usuario canceló setup');
    sessionStorage.clear();
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 to-slate-900 flex items-center justify-center p-6">
      <div className="max-w-2xl w-full bg-white rounded-2xl shadow-2xl overflow-hidden p-8">

        {/* Paso 1: Iniciar */}
        {step === 'init' && (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <div className="text-6xl mb-4">🔐</div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                Seguridad Requerida
              </h1>
              <p className="text-gray-600">
                Debes activar la autenticación de doble factor para continuar
              </p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
              <h3 className="font-semibold mb-3 text-blue-900">¿Qué necesitas?</h3>
              <ul className="space-y-2">
                <li className="flex items-center gap-2 text-blue-800">
                  <span className="text-xl">📱</span> Tu teléfono corporativo
                </li>
                <li className="flex items-center gap-2 text-blue-800">
                  <span className="text-xl">📲</span> Google Authenticator instalado
                </li>
                <li className="flex items-center gap-2 text-blue-800">
                  <span className="text-xl">📷</span> Acceso a la cámara para escanear QR
                </li>
              </ul>
            </div>

            <button
              onClick={handleInitSetup}
              disabled={loading}
              className="w-full bg-blue-600 text-white py-4 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-semibold text-lg mb-4"
            >
              {loading ? 'Generando...' : 'Continuar con la Activación'}
            </button>

            <button
              onClick={handleCancel}
              className="w-full text-gray-600 hover:text-gray-800 text-sm"
            >
              ← Volver al login
            </button>

            {error && (
              <div className="bg-red-50 text-red-700 p-3 rounded text-sm mt-4">
                {error}
              </div>
            )}
          </div>
        )}

        {/* Paso 2: Escanear QR */}
        {step === 'scan' && setupData && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-center mb-6">
              Escanea este Código QR
            </h2>

            <div className="flex justify-center mb-6">
              <img
                src={setupData.qr_code_url}
                alt="QR Code 2FA"
                className="w-72 h-72 border-4 border-gray-200 rounded-lg"
              />
            </div>

            <div className="bg-gray-50 p-4 rounded border mb-6">
              <p className="text-sm font-medium mb-2">
                ⚠️ Clave de respaldo (anótala):
              </p>
              <code className="block bg-white p-2 rounded border text-sm break-all">
                {setupData.secret}
              </code>
            </div>

            <button
              onClick={() => setStep('confirm')}
              className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 mb-2"
            >
              Ya escaneé el código →
            </button>

            <button
              onClick={handleCancel}
              className="w-full text-gray-600 hover:text-gray-800 text-sm"
            >
              ← Cancelar
            </button>
          </div>
        )}

        {/* Paso 3: Confirmar código */}
        {step === 'confirm' && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-center mb-6">
              Ingresa el Código
            </h2>

            {/* Indicador de intentos */}
            {attempts > 0 && !cooldownUntil && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-yellow-800 text-center">
                  ⚠️ Intentos: {attempts}/3
                </p>
              </div>
            )}

            {/* Indicador de cooldown */}
            {cooldownUntil && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-red-800 text-center font-semibold">
                  🔒 Bloqueado temporalmente
                </p>
                <p className="text-xs text-red-600 text-center mt-1">
                  Espera {cooldownSeconds} segundos
                </p>
              </div>
            )}

            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              disabled={!!cooldownUntil}
              className={`w-full text-center text-4xl tracking-widest border-2 rounded-lg p-4 mb-4 focus:border-blue-500 focus:outline-none ${
                cooldownUntil ? 'bg-gray-100 cursor-not-allowed' : ''
              }`}
              maxLength={6}
              autoFocus
            />

            {error && (
              <div className="bg-red-50 text-red-700 p-3 rounded mb-4 text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handleConfirm}
              disabled={loading || code.length !== 6 || !!cooldownUntil}
              className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 disabled:opacity-50 mb-2"
            >
              {loading ? 'Verificando...' : 'Confirmar Activación'}
            </button>

            <button
              onClick={handleCancel}
              disabled={loading}
              className="w-full text-gray-600 hover:text-gray-800 text-sm"
            >
              ← Cancelar
            </button>
          </div>
        )}

        {/* Paso 4: Éxito */}
        {step === 'success' && (
          <div className="text-center">
            <div className="text-6xl mb-4">✅</div>
            <h2 className="text-2xl font-bold mb-2">¡Listo!</h2>
            <p className="text-gray-600 mb-4">
              La autenticación de doble factor está activada.
              <br />
              Redirigiendo al dashboard...
            </p>
          </div>
        )}

      </div>
    </div>
  );
};