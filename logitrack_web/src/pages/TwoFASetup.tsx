import React, { useState } from 'react';
import { twoFAApi } from '../api/two-fa';
import type { TwoFASetupResponse } from '../types/two-fa';

export const TwoFASetup: React.FC = () => {
  const [step, setStep] = useState<'init' | 'scan' | 'confirm' | 'success'>('init');
  const [setupData, setSetupData] = useState<TwoFASetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleInitSetup = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await twoFAApi.setup();
      setSetupData(data);
      setStep('scan');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Error al iniciar configuración');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (code.length !== 6) {
      setError('El código debe tener 6 dígitos');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await twoFAApi.confirm({ code });
      setStep('success');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Código de verificación inválido');
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
            
            {/* QR Code desde data URL del backend */}
            <div className="flex justify-center mb-4">
              <img 
                src={setupData.qr_code_url} 
                alt="QR Code 2FA"
                className="w-64 h-64"
              />
            </div>

            {/* Backup manual del secret */}
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
          <div className="bg-white border rounded-lg p-6">
            <h3 className="font-semibold mb-4">
              Ingresa el código de 6 dígitos de tu app
            </h3>

            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="w-full text-center text-3xl tracking-widest border rounded-lg p-4 mb-4"
              maxLength={6}
              autoFocus
            />

            {error && (
              <div className="bg-red-50 text-red-700 p-3 rounded mb-4">
                {error}
              </div>
            )}

            <button
              onClick={handleConfirm}
              disabled={loading || code.length !== 6}
              className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 disabled:opacity-50"
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