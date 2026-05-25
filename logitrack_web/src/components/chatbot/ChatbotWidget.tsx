import React, { useState, useEffect, useRef } from 'react';
import { ChatMessageComponent } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { chatbotService } from '../../api/chatbot';
import type {
  ChatMessage,
  Shipment,
  ChatOption
} from '../../types/chatbot';
import './chatbot.css';

type ChatState = 'initial' | 'authenticating' | 'authenticated' | 'menu' | 'processing';

export const ChatbotWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<ChatState>('initial');
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [recipientDni, setRecipientDni] = useState<string>('');
  const [trackingId, setTrackingId] = useState<string>('');
  const [loading, setLoading] = useState(false);
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
        'Para ayudarte con tu envío, necesito que me proporciones:\n' +
        '1️⃣ Tu número de seguimiento (ID de envío)\n' +
        '2️⃣ Tu número de DNI\n\n' +
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

      const menuOptions = buildMenuOptions(response.available_actions);
      resetSessionTimer();

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
        label: '❌ Cancelar envío',
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
        // Primer paso: guardar tracking ID
        setTrackingId(input);
        addBotMessage('Perfecto. Ahora ingresa tu número de DNI:');
      } else {
        // Segundo paso: autenticar con DNI
        await handleAuthenticate(trackingId, input);
      }
    }
  };

  // Función para limpiar la sesión
  const clearSession = () => {
    setSessionActive(false);
    setState('initial');
    setShipment(null);
    setRecipientDni('');
    setTrackingId('');


    addBotMessage(
      '⏱️ Tu sesión ha expirado por seguridad.\n\n' +
      'Por favor, vuelve a autenticarte para continuar.'
    );

    // Limpiar el timer
    if (sessionTimeoutRef.current) {
      clearTimeout(sessionTimeoutRef.current);
      sessionTimeoutRef.current = null;
    }
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

    setState('authenticated');
    addBotMessage('¿Necesitas algo más?', [
      { label: '🏠 Volver al menú', value: 'menu', action: 'restart' }
    ]);
  };

  const handleCancelRequest = async () => {
    addBotMessage(
      '⚠️ ¿Estás seguro de que deseas cancelar tu envío?\n\n' +
      'Esta acción no se puede deshacer.',
      [
        { label: '✅ Sí, cancelar', value: 'yes', action: 'confirm_cancel' },
        { label: '❌ No, volver', value: 'no', action: 'restart' },
      ]
    );
  };

  const handleCancelConfirmation = async () => {
    const response = await chatbotService.cancelShipment(trackingId, recipientDni);

    addBotMessage(`✅ ${response.message}`);

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
    return ['delivered', 'returned', 'cancelled', 'lost', 'destroyed'].includes(status);
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
                : 'Escribe tu respuesta...'
            }
          />
        </div>
      )}
    </>
  );
};