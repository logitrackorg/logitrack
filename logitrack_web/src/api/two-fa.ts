// src/api/two-fa.ts
import { api } from './auth';
import type {
  TwoFASetupResponse,
  TwoFAVerifyRequest,
  TwoFAConfirmRequest,
  TwoFADisableRequest,
  TwoFAVerifyResponse,
} from '../types/two-fa';

export const twoFAApi = {
  // Iniciar configuración
  setup: async (): Promise<TwoFASetupResponse> => { 
    const { data } = await api.post('/2fa/setup'); 
    return data;
  },

  // Confirmar activación
  confirm: async (request: TwoFAConfirmRequest): Promise<void> => {
    await api.post('/2fa/confirm', request); 
  },

  // Verificar código durante login
  verify: async (request: TwoFAVerifyRequest): Promise<TwoFAVerifyResponse> => {
    const { data } = await api.post('/2fa/verify', request); 
    return data;
  },

  // Desactivar 2FA
  disable: async (request: TwoFADisableRequest): Promise<void> => {
    await api.post('/2fa/disable', request); 
  },
};