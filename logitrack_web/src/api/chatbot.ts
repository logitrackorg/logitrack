import axios from 'axios';
import type {
  ChatbotAuthRequest,
  ChatbotAuthResponse,
  SenderChatbotAuthResponse,
  RescheduleOptionsResponse,
  PickupResponse,
  RescheduleResponse,
  CancelResponse,
  FileClaimResponse,
  ClaimRespondResponse,
  ClaimType,
  DamageSubtype,
} from '../types/chatbot';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080/api/v1';

const chatbotAPI = axios.create({
  baseURL: `${API_BASE_URL}/public/chatbot`,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const chatbotService = {
  // US1: Autenticación
  authenticate: async (data: ChatbotAuthRequest): Promise<ChatbotAuthResponse> => {
    const response = await chatbotAPI.post<ChatbotAuthResponse>('/auth', data);
    return response.data;
  },

  // US2: Solicitar retiro en sucursal
  requestPickup: async (trackingId: string, recipientDni: string): Promise<PickupResponse> => {
    const response = await chatbotAPI.post<PickupResponse>('/pickup', {
      tracking_id: trackingId,
      recipient_dni: recipientDni,
    });
    return response.data;
  },

  // US3: Obtener opciones de reprogramación
  getRescheduleOptions: async (
    trackingId: string,
    recipientDni: string
  ): Promise<RescheduleOptionsResponse> => {
    const response = await chatbotAPI.get<RescheduleOptionsResponse>('/reschedule/options', {
      params: { tracking_id: trackingId, recipient_dni: recipientDni },
    });
    return response.data;
  },

  // US3: Reprogramar entrega
  rescheduleDelivery: async (
    trackingId: string,
    recipientDni: string,
    newDate: string
  ): Promise<RescheduleResponse> => {
    const response = await chatbotAPI.post<RescheduleResponse>('/reschedule', {
      tracking_id: trackingId,
      recipient_dni: recipientDni,
      new_delivery_date: newDate,
    });
    return response.data;
  },

  // US4: Rechazar envío (destinatario)
  cancelShipment: async (
    trackingId: string,
    recipientDni: string,
    reason?: string
  ): Promise<CancelResponse> => {
    const response = await chatbotAPI.post<CancelResponse>('/cancel', {
      tracking_id: trackingId,
      recipient_dni: recipientDni,
      reason: reason || 'Rechazado por el destinatario',
    });
    return response.data;
  },

  // LOGITRACK-457: Autenticación del remitente
  authenticateSender: async (trackingId: string, senderDni: string): Promise<SenderChatbotAuthResponse> => {
    const response = await chatbotAPI.post<SenderChatbotAuthResponse>('/sender/auth', {
      tracking_id: trackingId,
      sender_dni: senderDni,
    });
    return response.data;
  },

  // US5: Crear reclamo desde chatbot. Acepta el árbol completo (category +
  // damage_subtypes + delivery_subtype) para que el backend normalice el
  // claim_type con ClassifyClaimType — única fuente de verdad. claim_type
  // viaja igual como fallback para clientes/handlers legacy.
  fileClaim: async (input: {
    trackingId: string;
    claimantDni: string;
    claimantName: string;
    claimType: ClaimType;
    category?: string;
    damageSubtypes?: DamageSubtype[];
    deliverySubtype?: string;
    description: string;
    evidenceFile?: File;
  }): Promise<FileClaimResponse> => {
    const form = new FormData();
    form.append('tracking_id', input.trackingId);
    form.append('claimant_dni', input.claimantDni);
    form.append('claimant_name', input.claimantName);
    form.append('claim_type', input.claimType);
    if (input.category) form.append('category', input.category);
    if (input.damageSubtypes && input.damageSubtypes.length > 0) {
      form.append('damage_subtypes', input.damageSubtypes.join(','));
    }
    if (input.deliverySubtype) form.append('delivery_subtype', input.deliverySubtype);
    form.append('description', input.description);
    if (input.evidenceFile) form.append('evidence', input.evidenceFile);
    const response = await chatbotAPI.post<FileClaimResponse>('/claim', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  // US4: Responder a reclamo pending_customer
  respondToClaim: async (
    claimId: string,
    claimantDni: string,
    responseText: string,
    evidenceFile?: File
  ): Promise<ClaimRespondResponse> => {
    const form = new FormData();
    form.append('claim_id', claimId);
    form.append('claimant_dni', claimantDni);
    form.append('response_text', responseText);
    if (evidenceFile) form.append('evidence', evidenceFile);
    const response = await chatbotAPI.post<ClaimRespondResponse>('/claim/respond', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  // LOGITRACK-457: Cancelar envío (remitente)
  cancelBySender: async (
    trackingId: string,
    senderDni: string,
    reason?: string
  ): Promise<CancelResponse> => {
    const response = await chatbotAPI.post<CancelResponse>('/sender/cancel', {
      tracking_id: trackingId,
      sender_dni: senderDni,
      reason: reason || 'Cancelado por el remitente',
    });
    return response.data;
  },

};