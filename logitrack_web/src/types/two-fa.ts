import type { User } from '../api/auth';

export interface TwoFASetupResponse {
  secret: string;
  qr_code_url: string;
  issuer: string;
  account_name: string;
}

export interface TwoFAConfirmRequest {
  code: string;
}

export interface TwoFAVerifyRequest {
  session_token: string;
  code: string;
}

export interface TwoFAVerifyResponse {
  token: string;
  user: User;
}

export interface TwoFADisableRequest {
  password: string;
  code: string;
}

// Actualizar LoginResponse existente
export interface LoginResponse {
  token?: string;
  user?: User;
  requires_2fa: boolean;
  session_token?: string;
}