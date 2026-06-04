// src/pages/TwoFASetupRequired.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { twoFAApi } from '../api/two-fa';
import { useAuth } from '../context/AuthContext';
import type { TwoFASetupResponse } from '../types/two-fa';

export const TwoFASetupRequired: React.FC = () => {
  const [step, setStep] = useState<'intro' | 'scan' | 'confirm' | 'success'>('intro');
  const [setupData, setSetupData] = useState<TwoFASetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0); // ← NUEVO
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null); // ← NUEVO
  const [cooldownSeconds, setCooldownSeconds] = useState(0); // ← NUEVO

  const navigate = useNavigate();
  const location = useLocation();
  const { setToken, setUser } = useAuth();

  const message = location.state?.message || "La autenticación de doble factor es obligatoria";

  // ✨ NUEVO: Proteger contra refresh
  useEffect(() => {
    const user = localStorage.getItem('user');
    if (user) {
      const parsedUser = JSON.parse(user);
      // Si ya tiene 2FA activado, no debería estar aquí
      if (parsedUser.two_fa_enabled) {
        navigate('/');
      }
    }
  }, [navigate]);

  // ✨ NUEVO: Countdown del cooldown
  useEffect(() => {
    if (!cooldownUntil) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const remaining = Math.ceil((cooldownUntil - now) / 1000);

      if (remaining <= 0) {
        setCooldownUntil(null);
        setCooldownSeconds(0);
        setAttempts(0);
      } else {
        setCooldownSeconds(remaining);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [cooldownUntil]);

  const handleInitSetup = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await twoFAApi.setup();
      setSetupData(data);
      setStep('scan');
      setAttempts(0); // Reset intentos al generar nuevo QR
      setCooldownUntil(null);
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error || 'Error de verificación';
      setError(errorMsg);
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (code.length !== 6) {
      setError('El código debe tener 6 dígitos');
      return;
    }


    if (cooldownUntil && Date.now() < cooldownUntil) {
      setError(`Demasiados intentos. Espera ${cooldownSeconds} segundos.`);
      return;
    }

    setLoading(true);
    setError('');

    try {
      await twoFAApi.confirm({ code });


      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        const user = JSON.parse(storedUser);
        user.two_fa_enabled = true;
        user.two_fa_enrolled_at = new Date().toISOString();
        localStorage.setItem('user', JSON.stringify(user));

        const token = localStorage.getItem('token');
        if (token) {
          setToken(token);
          setUser(user);
        }
      }

      setStep('success');
      setAttempts(0);
      setCooldownUntil(null);

      setTimeout(() => {
        navigate('/');
      }, 2000);
    } catch {

      const newAttempts = attempts + 1;
      setAttempts(newAttempts);

      if (newAttempts >= 3) {
        const cooldownTime = Date.now() + 60000; // 60 segundos
        setCooldownUntil(cooldownTime);
        setCooldownSeconds(60);
        setError(`Código incorrecto. Has fallado ${newAttempts} veces. Espera 60 segundos antes de reintentar.`);
        setCode('');
      } else {
        setError(`Código incorrecto. Intento ${newAttempts} de 3.`);
        setCode('');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 to-slate-900 flex items-center justify-center p-6">
      <div className="max-w-2xl w-full bg-white rounded-2xl shadow-2xl overflow-hidden">

        {step === 'intro' && (
          <div className="p-8">
            <div className="text-center mb-6">
              <div className="text-6xl mb-4">🔐</div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                Seguridad Requerida
              </h1>
              <p className="text-gray-600">{message}</p>
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
              onClick={() => navigate('/login')}
              className="w-full text-gray-600 hover:text-gray-800 text-sm"
            >
              ← Volver al login
            </button>
          </div>
        )}

        {step === 'scan' && setupData && (
          <div className="p-8">
            <h2 className="text-2xl font-bold text-center mb-6">Escanea este Código QR</h2>

            <div className="flex justify-center mb-6">
              <img
                src={setupData.qr_code_url}
                alt="QR Code 2FA"
                className="w-72 h-72 border-4 border-gray-200 rounded-lg"
              />
            </div>

            <div className="bg-gray-50 p-4 rounded border mb-6">
              <p className="text-sm font-medium mb-2">⚠️ Clave de respaldo (anótala):</p>
              <code className="block bg-white p-2 rounded border text-sm break-all">
                {setupData.secret}
              </code>
            </div>

            <button
              onClick={() => setStep('confirm')}
              className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700"
            >
              Ya escaneé el código →
            </button>
          </div>
        )}

        {step === 'confirm' && (
          <div className="p-8">
            <h2 className="text-2xl font-bold text-center mb-6">Ingresa el Código</h2>


            {attempts > 0 && !cooldownUntil && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-yellow-800 text-center">
                  ⚠️ Intentos: {attempts}/3
                </p>
              </div>
            )}


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
              className={`w-full text-center text-4xl tracking-widest border-2 rounded-lg p-4 mb-4 focus:border-blue-500 focus:outline-none ${cooldownUntil ? 'bg-gray-100 cursor-not-allowed' : ''
                }`}
              maxLength={6}
              autoFocus={!cooldownUntil}
            />

            {error && (
              <div className="bg-red-50 text-red-700 p-3 rounded mb-4 text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handleConfirm}
              disabled={loading || code.length !== 6 || !!cooldownUntil}
              className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Verificando...' : 'Confirmar Activación'}
            </button>
          </div>
        )}

        {step === 'success' && (
          <div className="p-8 text-center">
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
