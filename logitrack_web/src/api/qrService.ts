import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api/v1';

export interface QRResponse {
  tracking_id: string;
  qr_code_base64: string;
  tracking_url: string;
}

export const qrService = {
  /**
   * Genera el código QR para un envío
   */
  async generateQR(trackingId: string): Promise<QRResponse> {
    const token = localStorage.getItem('token');
    const response = await axios.get<QRResponse>(
      `${API_URL}/shipments/${trackingId}/qr`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    return response.data;
  },

  /**
   * Retorna la URL para descargar el QR directamente
   */
  getDownloadURL(trackingId: string): string {
    const token = localStorage.getItem('token');
    return `${API_URL}/shipments/${trackingId}/qr/download?token=${token}`;
  },
};