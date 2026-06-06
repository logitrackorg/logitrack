import React, { useState, useEffect, useRef } from 'react';
import { ChatMessageComponent } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { chatbotService } from '../../api/chatbot';
import type {
  ChatMessage,
  Shipment,
  ChatOption,
  PendingClaimInfo,
} from '../../types/chatbot';
import './chatbot.css';

type ChatState =
  | 'initial'
  | 'authenticating'
  | 'authenticated'
  | 'menu'
  | 'processing'
  | 'claim_response'   // esperando texto de respuesta al reclamo
  | 'claim_evidence';  // esperando adjunto (o saltar)
type UserType = 'recipient' | 'sender' | null;

export const ChatbotWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<ChatState>('initial');
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [recipientDni, setRecipientDni] = useState<string>('');
  const [senderDni, setSenderDni] = useState<string>('');
  const [userType, setUserType] = useState<UserType>(null);
  const [awaitingDni, setAwaitingDni] = useState(false);
  const [trackingId, setTrackingId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  // US-4: claim response state
  const [pendingClaim, setPendingClaim] = useState<PendingClaimInfo | null>(null);
  const [claimResponseText, setClaimResponseText] = useState<string>('');
  const [pendingEvidenceFile, setPendingEvidenceFile] = useState<File | null>(null);
  const [sessionActive, setSessionActive] = useState(true);
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
      setTrackingId(trackingId);
      setState('authenticated');
      setSessionActive(true);
      resetSessionTimer();

      // US-4: si hay reclamo pendiente, mostrarlo de forma proactiva
      if (response.pending_claim) {
        setPendingClaim(response.pending_claim);
        const notes = response.pending_claim.supervisor_notes
          ? `\n\n📋 El equipo necesita: "${response.pending_claim.supervisor_notes}"`
          : '';
        addBotMessage(
          `¡Hola, ${response.recipient_name}! ✅\n\n` +
          `Tu reclamo **${response.pending_claim.claim_id}** está esperando tu respuesta.` +
          notes +
          `\n\n¿Querés responder ahora?`,
          [
            { label: '✏️ Sí, responder ahora', value: 'respond_claim', action: 'respond_claim' },
            { label: '⏭️ Responder después',   value: 'skip',          action: 'restart'       },
          ]
        );
        return;
      }

      const menuOptions = buildMenuOptions(response.available_actions);

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
      respond_claim: {
        label: '📝 Responder reclamo pendiente',
        value: 'respond_claim',
        action: 'respond_claim',
      },
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
    };

    return availableActions.map(action => optionsMap[action]).filter(Boolean);
  };

  const handleUserInput = async (input: string) => {
    addUserMessage(input);
    resetSessionTimer();

    if (state === 'authenticating') {
      if (!trackingId) {
        // Paso 1: guardar tracking ID y preguntar rol
        setTrackingId(input);
        addBotMessage(
          '¿Cómo ingresás al sistema?',
          [
            { label: '📦 Soy el destinatario', value: 'recipient', action: 'as_recipient' },
            { label: '🏢 Soy el remitente',    value: 'sender',    action: 'as_sender'    },
          ]
        );
      } else if (awaitingDni) {
        // Paso 3: autenticar con el DNI según el rol seleccionado
        setAwaitingDni(false);
        if (userType === 'sender') {
          await handleSenderAuthenticate(trackingId, input);
        } else {
          await handleAuthenticate(trackingId, input);
        }
      }
      return;
    }

    // US-4: capturar texto de la respuesta al reclamo
    if (state === 'claim_response') {
      if (input.trim().length === 0) return;
      if (input.trim().length > 400) {
        addBotMessage('⚠️ La respuesta no puede superar los 400 caracteres. Por favor resumila un poco.');
        return;
      }
      setClaimResponseText(input.trim());
      setState('claim_evidence');
      addBotMessage(
        '¿Querés adjuntar una foto o documento de respaldo?\n\n' +
        'Podés usar el botón 📎 para adjuntar, o continuar sin adjunto.',
        [
          { label: '⏭️ Continuar sin adjunto', value: 'skip_evidence', action: 'skip_evidence' },
        ]
      );
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
        case 'respond_claim':
          setState('claim_response');
          addBotMessage('Escribí tu respuesta al equipo (máximo 400 caracteres):');
          break;
        case 'skip_evidence':
          await handleSubmitClaimResponse(null);
          break;
        case 'confirm_claim_response':
          await handleSubmitClaimResponse(pendingEvidenceFile);
          break;
        case 'restart':
          handleRestart();
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

  const handleSubmitClaimResponse = async (file: File | null) => {
    if (!pendingClaim) return;
    setLoading(true);
    try {
      await chatbotService.respondToClaim(
        pendingClaim.claim_id,
        recipientDni,
        claimResponseText,
        file ?? undefined
      );
      addBotMessage(
        '✅ Tu respuesta fue enviada.\n\n' +
        'El equipo la revisará y te avisaremos cuando haya novedades.'
      );
      window.dispatchEvent(new CustomEvent('chatbot:claim-response-sent', {
        detail: { claimId: pendingClaim.claim_id },
      }));
      setPendingClaim(null);
      setClaimResponseText('');
      setPendingEvidenceFile(null);
      setState('authenticated');
      addBotMessage('¿Hay algo más en lo que pueda ayudarte?', [
        { label: '🏠 Volver al inicio', value: 'menu', action: 'restart' },
      ]);
    } catch (error) {
      const apiErr = error as { response?: { data?: { error?: string } } };
      addBotMessage('❌ ' + (apiErr.response?.data?.error || 'No se pudo enviar la respuesta. Por favor intentá de nuevo.'));
      setState('claim_evidence');
    } finally {
      setLoading(false);
    }
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
            disabled={loading || state === 'authenticated' || state === 'claim_evidence'}
            placeholder={
              state === 'authenticated'
                ? 'Seleccioná una opción...'
                : state === 'claim_response'
                  ? 'Escribí tu respuesta (máx. 400 caracteres)...'
                  : state === 'claim_evidence'
                    ? 'Usá el botón 📎 o seleccioná una opción...'
                    : 'Escribí tu respuesta...'
            }
            showFileUpload={state === 'claim_evidence'}
            onFileSelect={(file) => {
              setPendingEvidenceFile(file);
              addUserMessage(`📎 Adjunto: ${file.name}`);
              addBotMessage(
                `Adjunto recibido: **${file.name}**\n¿Confirmás el envío con este archivo?`,
                [
                  { label: '✅ Confirmar y enviar', value: 'confirm_claim_response', action: 'confirm_claim_response' },
                  { label: '🔄 Cambiar archivo',    value: 'change_file',            action: 'skip_evidence'         },
                ]
              );
            }}
          />
        </div>
      )}
    </>
  );
};