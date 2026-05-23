import axios from 'axios';
import type {
  ChatbotAuthRequest,
  ChatbotAuthResponse,
  RescheduleOptionsResponse,
  PickupResponse,
  RescheduleResponse,
  CancelResponse,
} from '../types/chatbot';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1';

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

  // US4: Cancelar envío
  cancelShipment: async (
    trackingId: string,
    recipientDni: string,
    reason?: string
  ): Promise<CancelResponse> => {
    const response = await chatbotAPI.post<CancelResponse>('/cancel', {
      tracking_id: trackingId,
      recipient_dni: recipientDni,
      reason: reason || 'Cancelado por el destinatario',
    });
    return response.data;
  },
};