import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { twoFAApi } from '../api/two-fa';
import { useAuth } from '../context/AuthContext'; // Tu contexto existente

export const TwoFAVerify: React.FC = () => {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { setSession } = useAuth();


  const sessionToken = location.state?.session_token;

  React.useEffect(() => {
    if (!sessionToken) {
      navigate('/login');
    }
  }, [sessionToken, navigate]);

  const handleVerify = async () => {
    if (code.length !== 6) {
      setError('El código debe tener 6 dígitos');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await twoFAApi.verify({
        session_token: sessionToken,
        code,
      });
      // CA 1: Validación exitosa - guardar token definitivo
      setSession(response.token, response.user);
      navigate('/dashboard');
    } catch (err: any) {
      // CA 2: Código inválido o vencido
      const errorMsg = err.response?.data?.error || 'Error de verificación';
      setError(errorMsg);
      setCode(''); // Limpiar para reintentar
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-lg max-w-md w-full">
        <div className="text-center mb-6">
          <div className="text-5xl mb-4">🔐</div>
          <h2 className="text-2xl font-bold">Verificación de Seguridad</h2>
          <p className="text-gray-600 mt-2">
            Ingresa el código de 6 dígitos de tu app Google Authenticator
          </p>
        </div>

        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          className="w-full text-center text-3xl tracking-widest border-2 rounded-lg p-4 mb-4 focus:border-blue-500 focus:outline-none"
          maxLength={6}
          autoFocus
        />

        {error && (
          <div className="bg-red-50 text-red-700 p-3 rounded mb-4 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleVerify}
          disabled={loading || code.length !== 6}
          className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Verificando...' : 'Verificar'}
        </button>

        <button
          onClick={() => navigate('/login')}
          className="w-full mt-3 text-gray-600 hover:text-gray-800 text-sm"
        >
          ← Volver al inicio de sesión
        </button>
      </div>
    </div>
  );
};