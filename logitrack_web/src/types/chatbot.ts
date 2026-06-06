// Tipos para el chatbot

export interface ChatbotAuthRequest {
  tracking_id: string;
  recipient_dni: string;
}

export interface ActiveClaimInfo {
  claim_id: string;
  status: string;
}

export interface FileClaimResponse {
  success: boolean;
  claim_id: string;
  message: string;
}

export interface ChatbotAuthResponse {
  success: boolean;
  recipient_name: string;
  shipment: Shipment;
  available_actions: string[];
  active_claim?: ActiveClaimInfo;
}

export interface Shipment {
  tracking_id: string;
  status: string;
  delivery_method: string;
  estimated_delivery_at?: string;
  chatbot_metadata?: ChatbotMetadata;
  final_branch_id?: string;
  recipient: Customer;
  sender: Customer;
}

export interface Customer {
  dni: string;
  name: string;
  phone: string;
  email?: string;
  address: Address;
}

export interface Address {
  street?: string;
  city: string;
  province: string;
  postal_code?: string;
}

export interface ChatbotMetadata {
  reschedule_count: number;
  max_reschedules: number;
  original_delivery_date?: string;
  scheduled_delivery_date?: string;
  last_chatbot_interaction?: string;
}

export interface RescheduleOptionsResponse {
  success: boolean;
  available_dates: string[];
  reschedule_count: number;
  max_reschedules: number;
  can_reschedule: boolean;
  message?: string;
}

export interface BranchInfo {
  name: string;
  address: string;
  hours: string;
}

export interface PickupResponse {
  success: boolean;
  message: string;
  branch?: BranchInfo;
}

export interface RescheduleResponse {
  success: boolean;
  message: string;
  new_delivery_date: string;
}

export interface CancelResponse {
  success: boolean;
  message: string;
}

export interface ChatMessage {
  id: string;
  type: 'bot' | 'user';
  text: string;
  timestamp: Date;
  options?: ChatOption[];
  data?: unknown;
}

export interface ChatOption {
  label: string;
  value: string;
  action: ChatAction;
}

export type ClaimType =
  | 'damage'
  | 'missing'
  | 'delay'
  | 'not_delivered'
  | 'bad_treatment'
  | 'wrong_data'
  | 'other';

export type DamageSubtype = 'product_damaged' | 'missing_products' | 'packaging_damaged';

export type ChatAction =
  | 'pickup'
  | 'reschedule'
  | 'cancel'
  | 'select_date'
  | 'confirm_cancel'
  | 'restart'
  | 'as_recipient'
  | 'as_sender'
  // US5: reclamos
  | 'file_claim'
  | 'select_claim_type'
  | 'toggle_damage_subtype'
  | 'confirm_damage_subtypes'
  | 'skip_claim_evidence'
  | 'confirm_claim_submit';
