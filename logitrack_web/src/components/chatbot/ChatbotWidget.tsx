import React, { useState, useEffect, useRef } from 'react';
import { ChatMessageComponent } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { chatbotService } from '../../api/chatbot';
import type {
  ChatMessage,
  Shipment,
  ChatOption,
  ClaimType,
  DamageSubtype,
} from '../../types/chatbot';
import './chatbot.css';

type ChatState =
  | 'initial'
  | 'authenticating'
  | 'authenticated'
  | 'menu'
  | 'processing'
  | 'claim_damage_subtypes'
  | 'claim_description'
  | 'claim_evidence';

type UserType = 'recipient' | 'sender' | null;

export const ChatbotWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<ChatState>('initial');
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [recipientDni, setRecipientDni] = useState<string>('');
  const [recipientName, setRecipientName] = useState<string>('');
  const [senderDni, setSenderDni] = useState<string>('');
  const [userType, setUserType] = useState<UserType>(null);
  const [awaitingDni, setAwaitingDni] = useState(false);
  const [trackingId, setTrackingId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [sessionActive, setSessionActive] = useState(true);
  // US5: estado del reclamo en construcción
  const [claimType, setClaimType] = useState<ClaimType | null>(null);
  const [damageSubtypes, setDamageSubtypes] = useState<DamageSubtype[]>([]);
  const [claimDescription, setClaimDescription] = useState<string>('');
  const [claimEvidenceFile, setClaimEvidenceFile] = useState<File | null>(null);
  const [evidenceRequired, setEvidenceRequired] = useState(false);

  const sessionTimeoutRef = useRef<number | null>(null);
  const SESSION_DURATION = 60000; // 1 minuto en milisegundos
  const [timeRemaining, setTimeRemaining] = useState(60);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const msgIdRef = useRef(0);



  // Auto-scroll al último mensaje
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Mensaje inicial al abrir
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      addBotMessage(
        '¡Hola! 👋 Soy tu asistente virtual de LogiTrack.\n\n' +
        'Por favor ingresa tu ID de envío:'
      );
      setState('authenticating');
    }
  }, [isOpen, messages.length]);

  const addBotMessage = (text: string, options?: ChatOption[], data?: unknown) => {
    const message: ChatMessage = {
      id: String(++msgIdRef.current),
      type: 'bot',
      text,
      timestamp: new Date(),
      options,
      data,
    };
    setMessages(prev => [...prev, message]);
  };

  const addUserMessage = (text: string) => {
    const message: ChatMessage = {
      id: String(++msgIdRef.current),
      type: 'user',
      text,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, message]);
  };

  const handleAuthenticate = async (trackingId: string, dni: string) => {
    setLoading(true);
    try {
      const response = await chatbotService.authenticate({
        tracking_id: trackingId,
        recipient_dni: dni,
      });

      setShipment(response.shipment);
      setRecipientDni(dni);
      setRecipientName(response.recipient_name);
      setTrackingId(trackingId);
      setState('authenticated');
      setSessionActive(true);

      const menuOptions = buildMenuOptions(response.available_actions);
      resetSessionTimer();

      // Si hay reclamo activo, informar y NO ofrecer crear uno nuevo
      if (response.active_claim) {
        const statusLabel: Record<string, string> = {
          open: 'Abierto',
          in_review: 'En revisión',
          pending_customer: 'Pendiente de tu respuesta',
          derived: 'Derivado',
        };
        const label = statusLabel[response.active_claim.status] ?? response.active_claim.status;
        addBotMessage(
          `¡Hola, ${response.recipient_name}! ✅\n\n` +
          `Encontré tu envío: ${trackingId}\n` +
          `Estado actual: ${getStatusText(response.shipment.status)}\n\n` +
          `📋 Ya tenés un reclamo abierto: **${response.active_claim.claim_id}** (${label}).\n` +
          `No podés abrir otro hasta que se resuelva el actual.`,
          menuOptions.length > 0 ? menuOptions : [{ label: '🏠 Volver al inicio', value: 'menu', action: 'restart' as const }]
        );
        return;
      }

      if (menuOptions.length > 0) {
        addBotMessage(
          `¡Perfecto, ${response.recipient_name}! ✅\n\n` +
          `Encontré tu envío: ${trackingId}\n` +
          `Estado actual: ${getStatusText(response.shipment.status)}\n\n` +
          `¿En qué puedo ayudarte?`,
          menuOptions
        );
      } else {
        addBotMessage(
          `¡Hola, ${response.recipient_name}! ✅\n\n` +
          `Encontré tu envío: ${trackingId}\n` +
          `Estado actual: ${getStatusText(response.shipment.status)}\n\n` +
          getNoActionsMessage(response.shipment.status),
          [{ label: '🏠 Volver al inicio', value: 'menu', action: 'restart' }]
        );
      }
    } catch (error) {
      const apiErr = error as { response?: { data?: { error?: string } } };
      addBotMessage(
        '❌ ' + (apiErr.response?.data?.error ||
          'No pudimos encontrar tu envío con los datos ingresados, por favor verifica e intenta nuevamente.')
      );
      setTrackingId('');
      setState('initial');
      setTimeout(() => {
        addBotMessage('Por favor ingresa nuevamente tu ID de envío:');
        setState('authenticating');
      }, 2000);
    } finally {
      setLoading(false);
    }
  };

  const handleSenderAuthenticate = async (trackingId: string, dni: string) => {
    setLoading(true);
    try {
      const response = await chatbotService.authenticateSender(trackingId, dni);
      setShipment(response.shipment);
      setSenderDni(dni);
      setTrackingId(trackingId);
      setState('authenticated');
      setSessionActive(true);
      resetSessionTimer();

      const senderActions = response.available_actions ?? [];
      const menuOptions = senderActions.map((a: string) => {
        if (a === 'cancel') return { label: '❌ Cancelar envío', value: 'cancel', action: 'cancel' as const };
        return null;
      }).filter(Boolean) as ChatOption[];

      if (menuOptions.length > 0) {
        addBotMessage(
          `¡Perfecto, ${response.sender_name}! ✅\n\n` +
          `Encontré tu envío: ${trackingId}\n` +
          `Estado actual: ${getStatusText(response.shipment.status)}\n\n` +
          `¿En qué puedo ayudarte?`,
          menuOptions
        );
      } else {
        addBotMessage(
          `¡Hola, ${response.sender_name}! ✅\n\n` +
          `Encontré tu envío: ${trackingId}\n` +
          `Estado actual: ${getStatusText(response.shipment.status)}\n\n` +
          getNoActionsMessage(response.shipment.status),
          [{ label: '🏠 Volver al inicio', value: 'menu', action: 'restart' }]
        );
      }
    } catch (error) {
      const apiErr = error as { response?: { data?: { error?: string } } };
      addBotMessage(
        '❌ ' + (apiErr.response?.data?.error ||
          'No pudimos verificar tu identidad. Por favor chequeá los datos e intentá de nuevo.')
      );
      setTrackingId('');
      setUserType(null);
      setState('initial');
      setTimeout(() => {
        addBotMessage('Por favor ingresá nuevamente tu ID de envío:');
        setState('authenticating');
      }, 2000);
    } finally {
      setLoading(false);
    }
  };

  const buildMenuOptions = (availableActions: string[]): ChatOption[] => {
    const optionsMap: Record<string, ChatOption> = {
      request_pickup: {
        label: '📦 Retirar por sucursal',
        value: 'pickup',
        action: 'pickup',
      },
      reschedule: {
        label: '📅 Reprogramar entrega',
        value: 'reschedule',
        action: 'reschedule',
      },
      cancel: {
        label: userType === 'sender' ? '❌ Cancelar envío' : '❌ Rechazar envío',
        value: 'cancel',
        action: 'cancel',
      },
      file_claim: {
        label: '📋 Hacer un reclamo',
        value: 'file_claim',
        action: 'file_claim',
      },
    };

    return availableActions.map(action => optionsMap[action]).filter(Boolean);
  };

  const handleUserInput = async (input: string) => {
    addUserMessage(input);
    resetSessionTimer();

    if (state === 'authenticating') {
      if (!trackingId) {
        setTrackingId(input);
        addBotMessage(
          '¿Cómo ingresás al sistema?',
          [
            { label: '📦 Soy el destinatario', value: 'recipient', action: 'as_recipient' },
            { label: '🏢 Soy el remitente',    value: 'sender',    action: 'as_sender'    },
          ]
        );
      } else if (awaitingDni) {
        setAwaitingDni(false);
        if (userType === 'sender') {
          await handleSenderAuthenticate(trackingId, input);
        } else {
          await handleAuthenticate(trackingId, input);
        }
      }
      return;
    }

    // US5: descripción del reclamo
    if (state === 'claim_description') {
      if (input.trim().length < 10) {
        addBotMessage('Por favor describí el problema con al menos 10 caracteres.');
        return;
      }
      if (input.trim().length > 400) {
        addBotMessage('La descripción no puede superar los 400 caracteres.');
        return;
      }
      setClaimDescription(input.trim());

      // ¿requiere evidencia?
      const needsEvidence = claimType === 'damage' && damageSubtypes.includes('product_damaged');
      setEvidenceRequired(needsEvidence);

      if (needsEvidence) {
        setState('claim_evidence');
        addBotMessage(
          '📎 Para este tipo de reclamo es **obligatorio** adjuntar una foto o documento del daño.\n\nUsá el botón 📎 para adjuntarlo.',
        );
      } else if (claimType === 'damage') {
        setState('claim_evidence');
        addBotMessage(
          '¿Querés adjuntar una foto o documento de respaldo? (opcional)\n\nPodés usar el botón 📎 o continuar sin adjunto.',
          [{ label: '⏭ Continuar sin adjunto', value: 'skip', action: 'skip_claim_evidence' as const }]
        );
      } else {
        await handleSubmitClaim(null);
      }
    }
  };

  // Función para limpiar la sesión
  const clearSession = () => {
    setSessionActive(false);
    setShipment(null);
    setRecipientDni('');
    setSenderDni('');
    setUserType(null);
    setAwaitingDni(false);
    setTrackingId('');

    addBotMessage(
      '⏱️ Tu sesión ha expirado por seguridad.\n\n' +
      'Por favor, ingresá nuevamente tu ID de envío para continuar.'
    );

    // Limpiar el timer
    if (sessionTimeoutRef.current) {
      clearTimeout(sessionTimeoutRef.current);
      sessionTimeoutRef.current = null;
    }

    // Volver a authenticating para que el usuario pueda reingresar sus datos
    setState('authenticating');
  };

  // Función para reiniciar el timer de inactividad
  const resetSessionTimer = () => {
    // Limpiar timer anterior si existe
    if (sessionTimeoutRef.current) {
      clearTimeout(sessionTimeoutRef.current);
    }
    setTimeRemaining(60);

    // Solo iniciar timer si hay una sesión activa (usuario autenticado)
    if (state === 'authenticated' || state === 'menu') {
      sessionTimeoutRef.current = setTimeout(() => {
        clearSession();
      }, SESSION_DURATION);
    }
  };

  // Limpiar timer al desmontar el componente
  useEffect(() => {
    return () => {
      if (sessionTimeoutRef.current) {
        clearTimeout(sessionTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (state === 'authenticated' && sessionActive) {
      const interval = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [state, sessionActive]);

  // Reset del countdown cuando cambia el estado
  useEffect(() => {
    if (state === 'authenticated') {
      setTimeRemaining(60);
    }
  }, [state]);

  // Detectar cuando el tiempo llega a 0 y cerrar sesión
  useEffect(() => {
    if (timeRemaining === 0 && sessionActive && state === 'authenticated') {
      clearSession();
    }
  }, [timeRemaining, sessionActive, state]);

  const handleSubmitClaim = async (evidence: File | null) => {
    if (!claimType || !trackingId) return;
    const name = userType === 'sender'
      ? (shipment?.sender.name ?? '')
      : (recipientName || shipment?.recipient.name || '');
    const dni = userType === 'sender' ? senderDni : recipientDni;
    try {
      const res = await chatbotService.fileClaim(
        trackingId, dni, name, claimType, damageSubtypes, claimDescription, evidence ?? undefined
      );
      addBotMessage(
        `✅ ${res.message}\n\nGuardá el número de reclamo: **${res.claim_id}**`,
        [{ label: '🏠 Volver al inicio', value: 'menu', action: 'restart' as const }]
      );
      window.dispatchEvent(new CustomEvent('chatbot:claim-created', { detail: { claimId: res.claim_id, trackingId } }));
    } catch (err) {
      const apiErr = err as { response?: { data?: { error?: string } } };
      addBotMessage('❌ ' + (apiErr.response?.data?.error || 'No se pudo registrar el reclamo. Intentá de nuevo.'));
    } finally {
      setClaimType(null);
      setDamageSubtypes([]);
      setClaimDescription('');
      setClaimEvidenceFile(null);
      setEvidenceRequired(false);
      setState('authenticated');
    }
  };

  const handleOptionClick = async (action: string, value: string) => {
    if (!sessionActive) {
      addBotMessage('⏱️ Tu sesión ha expirado por seguridad. Por favor vuelve a autenticarte.');
      handleRestart();
      return;
    }

    resetSessionTimer();
    setState('processing');
    setLoading(true);

    try {
      switch (action) {
        case 'as_recipient':
          setUserType('recipient');
          setAwaitingDni(true);
          addBotMessage('Ingresá tu número de DNI:');
          setState('authenticating');
          break;
        case 'as_sender':
          setUserType('sender');
          setAwaitingDni(true);
          addBotMessage('Ingresá tu número de DNI:');
          setState('authenticating');
          break;
        case 'pickup':
          await handlePickupRequest();
          break;
        case 'reschedule':
          await handleRescheduleRequest();
          break;
        case 'cancel':
          await handleCancelRequest();
          break;
        case 'select_date':
          await handleDateSelection(value);
          break;
        case 'confirm_cancel':
          await handleCancelConfirmation();
          break;
        case 'restart':
          handleRestart();
          break;

        // US5: flujo de reclamo
        case 'file_claim':
          addBotMessage(
            '📋 Vamos a registrar tu reclamo.\n\n¿Cuál es el motivo?',
            [
              { label: '📦 Daño / Faltante',       value: 'damage',        action: 'select_claim_type' as const },
              { label: '🕐 Demora en entrega',      value: 'delay',         action: 'select_claim_type' as const },
              { label: '🚫 No lo recibí',           value: 'not_delivered', action: 'select_claim_type' as const },
              { label: '😡 Maltrato del personal',  value: 'bad_treatment', action: 'select_claim_type' as const },
              { label: '📝 Datos incorrectos',      value: 'wrong_data',    action: 'select_claim_type' as const },
              { label: '❓ Otro',                   value: 'other',         action: 'select_claim_type' as const },
            ]
          );
          setState('authenticated');
          break;

        case 'select_claim_type': {
          const selectedType = value as ClaimType;
          setClaimType(selectedType);
          setDamageSubtypes([]);
          if (selectedType === 'damage') {
            setState('claim_damage_subtypes');
            addBotMessage(
              '¿Qué tipo de daño o faltante?  (podés elegir más de uno)',
              [
                { label: '📦 Producto dañado',    value: 'product_damaged',   action: 'toggle_damage_subtype' as const },
                { label: '📉 Falta mercadería',   value: 'missing_products',  action: 'toggle_damage_subtype' as const },
                { label: '📫 Embalaje dañado',    value: 'packaging_damaged', action: 'toggle_damage_subtype' as const },
                { label: '✅ Listo, continuar',   value: 'done',              action: 'confirm_damage_subtypes' as const },
              ]
            );
          } else {
            setState('claim_description');
            addBotMessage('Describí brevemente el problema (mínimo 10 caracteres, máximo 400):');
          }
          break;
        }

        case 'toggle_damage_subtype': {
          const sub = value as DamageSubtype;
          setDamageSubtypes(prev =>
            prev.includes(sub) ? prev.filter(s => s !== sub) : [...prev, sub]
          );
          // No avanzar de estado, el usuario confirma con "Listo"
          setState('claim_damage_subtypes');
          break;
        }

        case 'confirm_damage_subtypes':
          setState('claim_description');
          addBotMessage('Describí brevemente el problema (mínimo 10 caracteres, máximo 400):');
          break;

        case 'skip_claim_evidence':
          await handleSubmitClaim(null);
          break;

        case 'confirm_claim_submit':
          await handleSubmitClaim(claimEvidenceFile);
          break;

        default:
          addBotMessage('Opción no reconocida. Por favor intenta de nuevo.');
      }
    } catch (error) {
      const apiErr = error as { response?: { data?: { error?: string } } };
      addBotMessage('❌ ' + (apiErr.response?.data?.error || 'Ocurrió un error. Por favor intenta de nuevo.'));
      setState('authenticated');
      if (shipment) {
        const menuOptions = buildMenuOptions(getAvailableActions());
        if (menuOptions.length > 0) {
          addBotMessage('¿En qué más puedo ayudarte?', menuOptions);
        } else {
          addBotMessage(
            getNoActionsMessage(shipment.status),
            [{ label: '🏠 Volver al inicio', value: 'menu', action: 'restart' }]
          );
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePickupRequest = async () => {
    const response = await chatbotService.requestPickup(trackingId, recipientDni);

    addBotMessage(
      `✅ ${response.message}\n\n` +
      (response.branch ?
        `📍 Sucursal: ${response.branch.name}\n` +
        `📫 Dirección: ${response.branch.address}\n` +
        `🕐 Horarios: ${response.branch.hours}`
        : ''
      )
    );

    window.dispatchEvent(new CustomEvent('chatbot:pickup-success', { detail: { trackingId } }));

    setState('authenticated');
    addBotMessage('¿Necesitas algo más?', [
      { label: '🏠 Volver al menú', value: 'menu', action: 'restart' }
    ]);
  };

  const handleRescheduleRequest = async () => {
    const response = await chatbotService.getRescheduleOptions(trackingId, recipientDni);

    if (!response.can_reschedule) {
      addBotMessage(`❌ ${response.message}`);
      setState('authenticated');
      addBotMessage('¿Necesitas algo más?', [
        { label: '🏠 Volver al menú', value: 'menu', action: 'restart' }
      ]);
      return;
    }

    addBotMessage(
      `📅 Reprogramaciones disponibles: ${response.max_reschedules - response.reschedule_count} de ${response.max_reschedules}\n\n` +
      'Selecciona una nueva fecha de entrega:'
    );

    const dateOptions: ChatOption[] = response.available_dates.map(date => ({
      label: formatDate(date),
      value: date,
      action: 'select_date',
    }));

    addBotMessage('Fechas disponibles:', dateOptions);
  };

  const handleDateSelection = async (newDate: string) => {
    const response = await chatbotService.rescheduleDelivery(trackingId, recipientDni, newDate);

    addBotMessage(
      `✅ ${response.message}\n\n` +
      `📅 Nueva fecha de entrega: ${formatDate(response.new_delivery_date)}`
    );

    window.dispatchEvent(new CustomEvent('chatbot:reschedule-success', { detail: { trackingId } }));

    setState('authenticated');
    addBotMessage('¿Necesitas algo más?', [
      { label: '🏠 Volver al menú', value: 'menu', action: 'restart' }
    ]);
  };

  const handleCancelRequest = async () => {
    const verb = userType === 'sender' ? 'cancelar' : 'rechazar';
    addBotMessage(
      `⚠️ ¿Estás seguro de que deseás ${verb} el envío?\n\n` +
      'Esta acción no se puede deshacer.',
      [
        { label: `✅ Sí, ${verb}`, value: 'yes', action: 'confirm_cancel' },
        { label: '❌ No, volver',  value: 'no',  action: 'restart' },
      ]
    );
  };

  const handleCancelConfirmation = async () => {
    let response;
    if (userType === 'sender') {
      response = await chatbotService.cancelBySender(trackingId, senderDni);
    } else {
      response = await chatbotService.cancelShipment(trackingId, recipientDni);
    }

    addBotMessage(`✅ ${response.message}`);

    window.dispatchEvent(new CustomEvent('chatbot:cancel-success', { detail: { trackingId } }));

    setState('authenticated');
    addBotMessage('¿Hay algo más en lo que pueda ayudarte?', [
      { label: '🏠 Volver al inicio', value: 'menu', action: 'restart' }
    ]);
  };

  const handleRestart = () => {
    if (sessionTimeoutRef.current) {
      clearTimeout(sessionTimeoutRef.current);
      sessionTimeoutRef.current = null;
    }
    if (shipment) {
      // Remitente: solo mostrar opciones del remitente
      if (userType === 'sender') {
        const canCancel = !isTerminalStatus(shipment.status);
        if (canCancel) {
          setState('authenticated');
          addBotMessage('¿En qué puedo ayudarte?', [
            { label: '❌ Cancelar envío', value: 'cancel', action: 'cancel' },
          ]);
        } else {
          setState('authenticated');
          addBotMessage(getNoActionsMessage(shipment.status), [
            { label: '🏠 Volver al inicio', value: 'menu', action: 'restart' },
          ]);
        }
        return;
      }
      // Destinatario: mostrar menú completo
      const menuOptions = buildMenuOptions(getAvailableActions());
      if (menuOptions.length > 0) {
        setState('authenticated');
        addBotMessage('¿En qué puedo ayudarte?', menuOptions);
        return;
      }
    } else {
      setMessages([]);
      setShipment(null);
      setRecipientDni('');
      setTrackingId('');
      setState('initial');
      setSessionActive(true);
      setIsOpen(true); // Trigger initial message
    }

    // Reset completo: volver al principio para consultar un nuevo envío
    setShipment(null);
    setRecipientDni('');
    setSenderDni('');
    setUserType(null);
    setAwaitingDni(false);
    setTrackingId('');
    setState('authenticating');
    setMessages([]);
    addBotMessage(
      '¡Hola! 👋 Soy tu asistente virtual de LogiTrack.\n\n' +
      'Para ayudarte con tu envío, necesito que me proporciones:\n' +
      '1️⃣ Tu número de seguimiento (ID de envío)\n' +
      '2️⃣ Tu número de DNI\n\n' +
      'Por favor ingresa tu ID de envío:'
    );
  };

  const getAvailableActions = (): string[] => {
    if (!shipment) return [];

    const actions: string[] = [];

    // Simular lógica basada en el modelo
    if (shipment.delivery_method === 'ultima_milla' &&
      shipment.status !== 'out_for_delivery' &&
      !isTerminalStatus(shipment.status)) {
      actions.push('request_pickup');
    }

    if (shipment.status !== 'out_for_delivery' &&
      !isTerminalStatus(shipment.status) &&
      (shipment.chatbot_metadata?.reschedule_count || 0) < 2) {
      actions.push('reschedule');
    }

    if (shipment.status !== 'out_for_delivery' &&
      !isTerminalStatus(shipment.status)) {
      actions.push('cancel');
    }

    return actions;
  };

  const isTerminalStatus = (status: string): boolean => {
    return ['delivered', 'returned', 'cancelled', 'lost', 'destroyed',
            'rechazado', 'no_entregado', 'expired'].includes(status);
  };

  const getNoActionsMessage = (status: string): string => {
    switch (status) {
      case 'out_for_delivery':
        return '🚚 Tu paquete ya está en camino a tu domicilio. No es posible modificar el envío mientras está en reparto.\n\nSi no estás en casa al momento de la entrega, el repartidor dejará un aviso para coordinar un nuevo intento.';
      case 'delivered':
        return '✅ Tu envío fue entregado exitosamente. No hay acciones pendientes.';
      case 'ready_for_pickup':
        return '📦 Tu paquete ya está listo para retiro en la sucursal. Presentate con tu DNI para retirarlo.';
      case 'cancelled':
        return '❌ Este envío fue cancelado. Contactá al remitente para más información.';
      case 'returned':
        return '↩️ Este envío fue devuelto al remitente. Contactalo para coordinar la entrega.';
      default:
        return 'No hay acciones disponibles para tu envío en este momento. Podés comunicarte con el remitente para más información.';
    }
  };

  const getStatusText = (status: string): string => {
    const statusMap: Record<string, string> = {
      'at_origin_hub': 'En sucursal de origen',
      'loaded': 'Cargado en vehículo',
      'in_transit': 'En tránsito',
      'at_hub': 'En sucursal',
      'out_for_delivery': 'En reparto',
      'delivered': 'Entregado',
      'ready_for_pickup': 'Listo para retiro',
      'cancelled': 'Cancelado',
    };
    return statusMap[status] || status;
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-AR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <>
      {/* Botón flotante */}
      <button
        className={`chatbot-toggle ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Abrir chat"
      >
        {isOpen ? '✕' : '💬'}
      </button>

      {/* Ventana del chat */}
      {isOpen && (
        <div className="chatbot-widget">
          <div className="chatbot-header">
            <div className="header-content">
              <span className="bot-icon">🤖</span>
              <div>
                <h3>Asistente LogiTrack</h3>
                <span className={`status-indicator ${timeRemaining < 20 && sessionActive && state === 'authenticated' ? 'warning' : ''}`}>
                  {loading
                    ? '⏳ Procesando...'
                    : sessionActive && state === 'authenticated'
                      ? `🟢 Sesión activa (${timeRemaining}s)`
                      : '🟢 En línea'}
                </span>
              </div>
            </div>
            <button
              className="close-button"
              onClick={() => {
                setIsOpen(false);
                if (sessionTimeoutRef.current) {
                  clearTimeout(sessionTimeoutRef.current);
                }
              }}
              aria-label="Cerrar chat"
            >
              ✕
            </button>
          </div>

          <div className="chatbot-messages">
            {messages.map(message => (
              <ChatMessageComponent
                key={message.id}
                message={message}
                onOptionClick={handleOptionClick}
              />
            ))}
            {loading && (
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <ChatInput
            onSend={handleUserInput}
            disabled={loading || state === 'authenticated'}
            placeholder={
              state === 'authenticated'
                ? 'Selecciona una opción...'
                : state === 'claim_evidence'
                ? 'Seleccioná un archivo o usá las opciones...'
                : 'Escribe tu respuesta...'
            }
            showFileUpload={state === 'claim_evidence'}
            fileUploadDisabled={loading}
            onFileSelect={(file) => {
              setClaimEvidenceFile(file);
              addUserMessage(`📎 ${file.name}`);
              // Si la evidencia es obligatoria, sólo se puede confirmar o cambiar el archivo.
              // Si es opcional, también se puede saltar.
              const confirmOptions: ChatOption[] = [
                { label: '✅ Confirmar y enviar reclamo', value: 'confirm', action: 'confirm_claim_submit' as const },
                { label: '🔄 Cambiar archivo', value: 'change', action: 'skip_claim_evidence' as const },
              ];
              if (!evidenceRequired) {
                confirmOptions.push({ label: '⏭ Enviar sin adjunto', value: 'skip', action: 'skip_claim_evidence' as const });
              }
              addBotMessage(
                `📎 Archivo seleccionado: **${file.name}**\n\n¿Confirmás que querés adjuntarlo al reclamo?`,
                confirmOptions
              );
            }}
          />
        </div>
      )}
    </>
  );
};