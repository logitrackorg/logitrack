import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, X, Bot, Loader } from 'lucide-react';
import { ChatMessageComponent } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { chatbotService } from '../../api/chatbot';
import { Button } from '@/components/ui/button';
import { fmtDate } from '@/utils/date';
import posthog from 'posthog-js';
import type {
  ChatMessage,
  Shipment,
  ChatOption,
  ClaimType,
  DamageSubtype,
  ActiveClaimInfo,
} from '../../types/chatbot';
import { canFileClaimOfType, CLAIM_INELIGIBLE_MESSAGE } from '../../utils/claimEligibility';
import {
  CLAIM_CATEGORIES,
  DELIVERY_SUBTYPE_OPTIONS,
  DAMAGE_SUBTYPE_OPTIONS,
  classifyClaimType,
  type ClaimCategory,
  type DeliverySubtype,
} from '../../utils/claimDecisionTree';
import {
  getPreFilterRoot,
  isLeaf,
  type PreFilterNode,
  type PreFilterLeaf,
  type PreFilterCtx,
} from '../../utils/claimPreFilter';

type ChatState =
  | 'initial'
  | 'authenticating'
  | 'authenticated'
  | 'menu'
  | 'processing'
  | 'claim_response'
  | 'claim_response_evidence'
  | 'claim_damage_subtypes'
  | 'claim_delivery_subtype'
  | 'claim_description'
  | 'claim_evidence';

type UserType = 'recipient' | 'sender' | null;

export function ChatbotWidget() {
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
  // US4: estado del flujo de respuesta a reclamo pendiente
  const [activeClaim, setActiveClaim] = useState<ActiveClaimInfo | null>(null);
  const [claimResponseText, setClaimResponseText] = useState<string>('');
  const [pendingClaimId, setPendingClaimId] = useState<string>('');
  const [pendingEvidenceFile, setPendingEvidenceFile] = useState<File | null>(null);
  // US5: estado del reclamo en construcción.
  const [claimCategory, setClaimCategory] = useState<ClaimCategory | null>(null);
  const [claimType, setClaimType] = useState<ClaimType | null>(null);
  const [damageSubtypes, setDamageSubtypes] = useState<DamageSubtype[]>([]);
  const [deliverySubtype, setDeliverySubtype] = useState<DeliverySubtype | ''>('');
  const [claimDescription, setClaimDescription] = useState<string>('');
  const [claimEvidenceFile, setClaimEvidenceFile] = useState<File | null>(null);
  const [evidenceRequired, setEvidenceRequired] = useState(false);
  // Pre-filtro guiado: nodo activo del árbol de decisión
  const [preFilterNode, setPreFilterNode] = useState<PreFilterNode | null>(null);
  // Sucursal de origen (para mensaje de cierre en árbol "otro")
  const [originBranch, setOriginBranch] = useState<{ name: string; address: string; hours: string } | null>(null);

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
      posthog.capture('chatbot_opened');
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
      setActiveClaim(response.active_claim ?? null);
      setOriginBranch(response.origin_branch ?? null);
      posthog.capture('chatbot_authenticated', {
        user_type: 'recipient',
        shipment_status: response.shipment.status,
        available_actions: response.available_actions,
      });
      setState('authenticated');
      setSessionActive(true);
      resetSessionTimer();

      const menuOptions = buildMenuOptions(response.available_actions);

      // Si hay reclamo activo, informar y actuar según el estado
      if (response.active_claim) {
        const { claim_id, status } = response.active_claim;
        const canRespond = response.available_actions.includes('respond_claim');

        if (status === 'pending_customer' && canRespond) {
          // Reclamo esperando respuesta del cliente — flujo proactivo (US-4)
          addBotMessage(
            `¡Hola, ${response.recipient_name}! ✅\n\n` +
            `Encontré tu envío: ${trackingId}\n` +
            `Estado actual: ${getStatusText(response.shipment.status)}\n\n` +
            `📋 Tu reclamo **${claim_id}** está esperando tu respuesta.\n` +
            `¿Querés responderlo ahora?`,
            [
              { label: '✏️ Sí, responder ahora', value: 'respond_claim', action: 'respond_claim' as const },
              { label: '⏭️ Responder después', value: 'skip', action: 'restart' as const },
            ]
          );
        } else {
          const statusLabel: Record<string, string> = {
            open: 'Abierto',
            in_review: 'En revisión',
            pending_customer: 'En revisión',
            derived: 'Derivado',
          };
          const label = statusLabel[status] ?? status;
          addBotMessage(
            `¡Hola, ${response.recipient_name}! ✅\n\n` +
            `Encontré tu envío: ${trackingId}\n` +
            `Estado actual: ${getStatusText(response.shipment.status)}\n\n` +
            `📋 Ya hay un reclamo abierto: **${claim_id}** (${label}).\n` +
            `No podés abrir otro hasta que se resuelva el actual.`,
            menuOptions.length > 0 ? menuOptions : [{ label: '🏠 Volver al inicio', value: 'menu', action: 'restart' as const }]
          );
        }
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
          getNoActionsMessage(response.shipment.status, response.origin_branch),
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
      setActiveClaim(response.active_claim ?? null);
      setOriginBranch(response.origin_branch ?? null);
      posthog.capture('chatbot_authenticated', {
        user_type: 'sender',
        shipment_status: response.shipment.status,
        available_actions: response.available_actions ?? [],
      });
      setState('authenticated');
      setSessionActive(true);
      resetSessionTimer();

      const menuOptions = buildMenuOptions(response.available_actions ?? []);

      // Si hay reclamo activo, informar y actuar según el estado
      if (response.active_claim) {
        const { claim_id, status } = response.active_claim;
        const canRespond = response.available_actions.includes('respond_claim');

        if (status === 'pending_customer' && canRespond) {
          addBotMessage(
            `¡Hola, ${response.sender_name}! ✅\n\n` +
            `Encontré tu envío: ${trackingId}\n` +
            `Estado actual: ${getStatusText(response.shipment.status)}\n\n` +
            `📋 Tu reclamo **${claim_id}** está esperando tu respuesta.\n` +
            `¿Querés responderlo ahora?`,
            [
              { label: '✏️ Sí, responder ahora', value: 'respond_claim', action: 'respond_claim' as const },
              { label: '⏭️ Responder después', value: 'skip', action: 'restart' as const },
            ]
          );
        } else {
          const statusLabel: Record<string, string> = {
            open: 'Abierto',
            in_review: 'En revisión',
            pending_customer: 'En revisión',
            derived: 'Derivado',
          };
          const label = statusLabel[status] ?? status;
          addBotMessage(
            `¡Hola, ${response.sender_name}! ✅\n\n` +
            `Encontré tu envío: ${trackingId}\n` +
            `Estado actual: ${getStatusText(response.shipment.status)}\n\n` +
            `📋 Ya hay un reclamo abierto: **${claim_id}** (${label}).\n` +
            `No podés abrir otro hasta que se resuelva el actual.`,
            menuOptions.length > 0 ? menuOptions : [{ label: '🏠 Volver al inicio', value: 'menu', action: 'restart' as const }]
          );
        }
        return;
      }

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
          getNoActionsMessage(response.shipment.status, response.origin_branch),
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
            { label: '🏢 Soy el remitente', value: 'sender', action: 'as_sender' },
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

    // US4: texto de respuesta al reclamo pendiente
    if (state === 'claim_response') {
      if (input.trim().length < 15) {
        addBotMessage('⚠️ La respuesta debe tener al menos 15 caracteres.');
        return;
      }
      if (input.trim().length > 400) {
        addBotMessage('⚠️ La respuesta no puede superar los 400 caracteres. Por favor resumila un poco.');
        return;
      }
      setClaimResponseText(input.trim());
      setState('claim_response_evidence');
      addBotMessage(
        '¿Querés adjuntar una foto o documento de respaldo? (opcional)\n\nPodés usar el botón 📎 para adjuntar, o continuar sin adjunto.',
        [{ label: '⏭️ Continuar sin adjunto', value: 'skip', action: 'skip_claim_response_evidence' as const }]
      );
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
      const desc = input.trim();
      setClaimDescription(desc);

      const needsEvidence = claimCategory === 'incomplete_damage' && damageSubtypes.includes('product_damaged');
      setEvidenceRequired(needsEvidence);

      if (needsEvidence) {
        setState('claim_evidence');
        addBotMessage(
          '📎 Para este tipo de reclamo es **obligatorio** adjuntar una foto o documento del daño.\n\nUsá el botón 📎 para adjuntarlo.',
        );
      } else if (claimCategory === 'incomplete_damage') {
        setState('claim_evidence');
        addBotMessage(
          '¿Querés adjuntar una foto o documento de respaldo? (opcional)\n\nPodés usar el botón 📎 o continuar sin adjunto.',
          [{ label: '⏭ Continuar sin adjunto', value: 'skip', action: 'skip_claim_evidence' as const }]
        );
      } else {
        await handleSubmitClaim(null, desc);
      }
    }
  };

  // Función para limpiar la sesión
  const clearSession = useCallback(() => {
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
  }, []);

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
  }, [timeRemaining, sessionActive, state, clearSession]);

  // US-4: enviar respuesta a reclamo pendiente_customer
  const handleSubmitClaimResponse = async (file: File | null) => {
    if (!pendingClaimId) return;
    setLoading(true);
    try {
      const dni = userType === 'sender' ? senderDni : recipientDni;
      await chatbotService.respondToClaim(pendingClaimId, dni, claimResponseText, file ?? undefined);
      addBotMessage(
        '✅ Tu respuesta fue enviada correctamente.\n\n' +
        'El equipo la revisará y te avisaremos cuando haya novedades.'
      );
      window.dispatchEvent(new CustomEvent('chatbot:claim-response-sent', {
        detail: { claimId: pendingClaimId },
      }));
      setPendingClaimId('');
      setClaimResponseText('');
      setPendingEvidenceFile(null);
      setState('authenticated');
      addBotMessage('¿Hay algo más en lo que pueda ayudarte?', [
        { label: '🏠 Volver al inicio', value: 'menu', action: 'restart' as const },
      ]);
    } catch (error) {
      const apiErr = error as { response?: { data?: { error?: string } } };
      addBotMessage('❌ ' + (apiErr.response?.data?.error || 'No se pudo enviar la respuesta. Intentá de nuevo.'));
      setState('claim_response_evidence');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitClaim = async (evidence: File | null, descriptionOverride?: string) => {
    if (!claimCategory || !trackingId) return;
    const name = userType === 'sender'
      ? (shipment?.sender.name ?? '')
      : (recipientName || shipment?.recipient.name || '');
    const dni = userType === 'sender' ? senderDni : recipientDni;
    // Usar el override si se pasó (evita race condition con setClaimDescription)
    const desc = descriptionOverride ?? claimDescription;
    // El backend normalizará el claim_type con ClassifyClaimType desde la
    // categoría + subtipos. Mandamos el claim_type derivado como fallback de
    // compat (clientes legacy que no manejen `category` en el server).
    const resolvedClaimType = claimType ?? classifyClaimType(claimCategory, damageSubtypes, deliverySubtype);
    try {
      const res = await chatbotService.fileClaim({
        trackingId,
        claimantDni: dni,
        claimantName: name,
        claimType: resolvedClaimType,
        category: claimCategory,
        damageSubtypes,
        deliverySubtype: deliverySubtype || undefined,
        description: desc,
        evidenceFile: evidence ?? undefined,
      });
      posthog.capture('chatbot_claim_submitted', {
        claim_type: resolvedClaimType,
        claim_category: claimCategory,
        user_type: userType,
        shipment_status: shipment?.status,
      });
      addBotMessage(
        `✅ ${res.message}\n\nGuardá el número de reclamo: **${res.claim_id}**`,
        [{ label: '🏠 Volver al inicio', value: 'menu', action: 'restart' as const }]
      );
      window.dispatchEvent(new CustomEvent('chatbot:claim-created', { detail: { claimId: res.claim_id, trackingId } }));
    } catch (err) {
      const apiErr = err as { response?: { data?: { error?: string } } };
      addBotMessage('❌ ' + (apiErr.response?.data?.error || 'No se pudo registrar el reclamo. Intentá de nuevo.'));
    } finally {
      setClaimCategory(null);
      setClaimType(null);
      setDamageSubtypes([]);
      setDeliverySubtype('');
      setClaimDescription('');
      setClaimEvidenceFile(null);
      setEvidenceRequired(false);
      setState('authenticated');
    }
  };

  // ─── Pre-filtro ────────────────────────────────────────────────────────────

  const preFilterCtx = (): PreFilterCtx => ({
    status: shipment?.status ?? '',
    estimated_delivery_at: shipment?.estimated_delivery_at,
  });

  const branchContact = originBranch
    ? `${originBranch.name} — ${originBranch.address}`
    : undefined;

  /** Avanza al formulario de reclamo después de que el pre-filtro pasó. */
  const continueToClaimForm = (category: ClaimCategory, prefillSubtypes?: DamageSubtype[]) => {
    const catDef = CLAIM_CATEGORIES.find(c => c.value === category);
    if (!catDef) return;

    if (catDef.requiresDamageSubtype) {
      const current = prefillSubtypes ?? damageSubtypes;
      if (current.length > 0) {
        // Subtipo ya pre-llenado por el pre-filtro — saltar directo a descripción
        if (prefillSubtypes) setDamageSubtypes(prefillSubtypes);
        setState('claim_description');
        addBotMessage('Describí brevemente el problema (mínimo 10 caracteres, máximo 400):');
      } else {
        setState('claim_damage_subtypes');
        const opts = DAMAGE_SUBTYPE_OPTIONS.map(opt => ({
          label: opt.label,
          value: opt.value,
          action: 'toggle_damage_subtype' as const,
        }));
        addBotMessage('¿Qué tipo de daño o faltante? (podés elegir más de uno)', [
          ...opts,
          { label: '✅ Listo, continuar', value: 'done', action: 'confirm_damage_subtypes' as const },
        ]);
      }
    } else if (catDef.requiresDeliverySubtype) {
      setState('claim_delivery_subtype');
      addBotMessage(
        '¿Cuál fue el problema con la entrega?',
        DELIVERY_SUBTYPE_OPTIONS.map(opt => ({
          label: opt.label,
          value: opt.value,
          action: 'select_delivery_subtype' as const,
        })),
      );
    } else {
      setState('claim_description');
      addBotMessage('Describí brevemente el problema (mínimo 10 caracteres, máximo 400):');
    }
  };

  /** Maneja un resultado leaf del árbol de pre-filtro. */
  const handlePreFilterLeaf = (leaf: PreFilterLeaf, category: ClaimCategory) => {
    setPreFilterNode(null);
    if (leaf.kind === 'resolved') {
      addBotMessage(`ℹ️ ${leaf.message}`, [
        { label: '🏠 Volver al inicio', value: 'menu', action: 'restart' as const },
      ]);
      setState('authenticated');
      return;
    }
    if (leaf.kind === 'redirect') {
      // not_delivered → redirigir al árbol de demora
      const newCat = leaf.to;
      setClaimCategory(newCat);
      setClaimType('delay');
      const step = getPreFilterRoot(newCat, preFilterCtx(), branchContact);
      if (isLeaf(step)) {
        handlePreFilterLeaf(step, newCat);
      } else {
        setPreFilterNode(step);
        addBotMessage(step.question, step.options.map(o => ({
          label: o.label, value: o.value, action: 'prefilter_answer' as const,
        })));
      }
      return;
    }
    // kind === 'continue'
    const prefill = leaf.prefillDamageSubtypes;
    if (leaf.noteMessage) {
      addBotMessage(`ℹ️ ${leaf.noteMessage}`);
    }
    continueToClaimForm(category, prefill);
  };

  /** Inicia el pre-filtro para la categoría elegida. */
  const startClaimPreFilter = (category: ClaimCategory) => {
    const step = getPreFilterRoot(category, preFilterCtx(), branchContact);
    if (isLeaf(step)) {
      handlePreFilterLeaf(step, category);
    } else {
      setPreFilterNode(step);
      addBotMessage(step.question, step.options.map(o => ({
        label: o.label, value: o.value, action: 'prefilter_answer' as const,
      })));
    }
  };

  // ───────────────────────────────────────────────────────────────────────────

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
          posthog.capture('chatbot_option_selected', { action: 'pickup', shipment_status: shipment?.status, user_type: userType });
          await handlePickupRequest();
          break;
        case 'reschedule':
          posthog.capture('chatbot_option_selected', { action: 'reschedule', shipment_status: shipment?.status, user_type: userType });
          await handleRescheduleRequest();
          break;
        case 'cancel':
          posthog.capture('chatbot_option_selected', { action: 'cancel', shipment_status: shipment?.status, user_type: userType });
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

        // US4: responder reclamo pendiente_customer
        case 'respond_claim': {
          posthog.capture('chatbot_option_selected', { action: 'respond_claim', shipment_status: shipment?.status, user_type: userType });
          setPendingClaimId(activeClaim?.claim_id ?? '');
          setState('claim_response');
          const notes = activeClaim?.supervisor_notes;
          const prompt = notes
            ? `📋 **El equipo necesita más información:**\n> ${notes}\n\nPor favor escribí tu respuesta (máximo 400 caracteres):`
            : '✏️ Escribí tu respuesta al equipo de LogiTrack (máximo 400 caracteres):';
          addBotMessage(prompt);
          break;
        }

        case 'skip_claim_response_evidence':
          await handleSubmitClaimResponse(null);
          break;

        case 'confirm_claim_response':
          await handleSubmitClaimResponse(pendingEvidenceFile);
          break;

        // US5: flujo de reclamo — el menú deriva del árbol compartido
        // (CLAIM_CATEGORIES). Cada categoría conoce su defaultClaimType, qué
        // subtipos pide y qué descripción usa.
        case 'file_claim': {
          posthog.capture('chatbot_option_selected', { action: 'file_claim', shipment_status: shipment?.status, user_type: userType });
          const allEligible = shipment
            ? CLAIM_CATEGORIES.every(cat => canFileClaimOfType(shipment, cat.defaultClaimType))
            : true;
          const options: ChatOption[] = CLAIM_CATEGORIES.map(cat => {
            const eligible = !shipment || canFileClaimOfType(shipment, cat.defaultClaimType);
            return eligible
              ? { label: cat.chatbotLabel, value: cat.value, action: 'select_claim_type' as const }
              : { label: `🔒 ${cat.chatbotLabel}`, value: cat.value, action: 'claim_type_blocked' as const };
          });
          const prompt = allEligible
            ? '📋 Vamos a registrar tu reclamo.\n\n¿Cuál es el motivo?'
            : `📋 Vamos a registrar tu reclamo.\n\n⚠️ ${CLAIM_INELIGIBLE_MESSAGE}\n\nPor ahora solo podés iniciar un reclamo de **Maltrato del personal**. ¿Cuál es el motivo?`;
          addBotMessage(prompt, options);
          setState('authenticated');
          break;
        }

        case 'claim_type_blocked':
          addBotMessage(`⚠️ ${CLAIM_INELIGIBLE_MESSAGE}`);
          setState('authenticated');
          break;

        case 'select_claim_type': {
          const selectedCategory = value as ClaimCategory;
          const categoryDef = CLAIM_CATEGORIES.find(c => c.value === selectedCategory);
          if (!categoryDef) {
            addBotMessage('Opción no reconocida. Por favor intenta de nuevo.');
            setState('authenticated');
            break;
          }
          if (shipment && !canFileClaimOfType(shipment, categoryDef.defaultClaimType)) {
            addBotMessage(`⚠️ ${CLAIM_INELIGIBLE_MESSAGE}`);
            setState('authenticated');
            break;
          }
          posthog.capture('chatbot_claim_type_selected', {
            claim_category: selectedCategory,
            claim_type: categoryDef.defaultClaimType,
            user_type: userType,
          });
          setClaimCategory(selectedCategory);
          setClaimType(categoryDef.defaultClaimType);
          setDamageSubtypes([]);
          setDeliverySubtype('');
          setState('authenticated');
          startClaimPreFilter(selectedCategory);
          break;
        }

        case 'prefilter_answer': {
          if (!preFilterNode || !claimCategory) {
            addBotMessage('Opción no reconocida. Por favor intenta de nuevo.');
            setState('authenticated');
            break;
          }
          const next = preFilterNode.next(value, preFilterCtx());
          if (isLeaf(next)) {
            handlePreFilterLeaf(next, claimCategory);
          } else {
            setPreFilterNode(next);
            addBotMessage(next.question, next.options.map(o => ({
              label: o.label, value: o.value, action: 'prefilter_answer' as const,
            })));
          }
          break;
        }

        case 'select_delivery_subtype': {
          const sub = value as DeliverySubtype;
          setDeliverySubtype(sub);
          // wrong_address mapea a wrong_data, el resto a not_delivered. Lo
          // resolvemos local para coherencia del estado, pero el backend
          // recalcula con ClassifyClaimType.
          if (claimCategory) {
            setClaimType(classifyClaimType(claimCategory, damageSubtypes, sub));
          }
          setState('claim_description');
          addBotMessage('Describí brevemente el problema (mínimo 10 caracteres, máximo 400):');
          break;
        }

        case 'toggle_damage_subtype': {
          const sub = value as DamageSubtype;
          const newSubtypes = damageSubtypes.includes(sub)
            ? damageSubtypes.filter(s => s !== sub)
            : [...damageSubtypes, sub];
          setDamageSubtypes(newSubtypes);
          setState('claim_damage_subtypes');

          const label = (s: DamageSubtype) => {
            const opt = DAMAGE_SUBTYPE_OPTIONS.find(o => o.value === s);
            const base = opt?.label ?? s;
            return newSubtypes.includes(s) ? `✅ ${base}` : `⬜ ${base}`;
          };
          addBotMessage(
            newSubtypes.length === 0
              ? '¿Qué tipo de daño o faltante? (podés elegir más de uno)'
              : `Seleccionados: ${newSubtypes.length}. ¿Alguno más o continuás?`,
            [
              ...DAMAGE_SUBTYPE_OPTIONS.map(opt => ({
                label: label(opt.value),
                value: opt.value,
                action: 'toggle_damage_subtype' as const,
              })),
              { label: '✅ Listo, continuar', value: 'done', action: 'confirm_damage_subtypes' as const },
            ]
          );
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
        { label: '❌ No, volver', value: 'no', action: 'restart' },
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
      // Remitente: reconstruir acciones disponibles desde estado local
      if (userType === 'sender') {
        const senderActions: string[] = [];
        if (!isTerminalStatus(shipment.status)) {
          senderActions.push('cancel');
        }
        if (activeClaim?.status === 'pending_customer') {
          senderActions.push('respond_claim');
        } else if (!activeClaim && shipment.status !== 'draft') {
          // file_claim siempre disponible (excepto draft): bad_treatment es
          // reclamable en cualquier estado; el resto se bloquea al elegir tipo.
          senderActions.push('file_claim');
        }
        const menuOptions = buildMenuOptions(senderActions);
        setState('authenticated');
        if (menuOptions.length > 0) {
          addBotMessage('¿En qué puedo ayudarte?', menuOptions);
        } else {
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

    // file_claim siempre disponible (excepto draft): bad_treatment se puede
    // iniciar en cualquier estado; los demás tipos se bloquean al seleccionar.
    if (!activeClaim && shipment.status !== 'draft') {
      actions.push('file_claim');
    }

    return actions;
  };

  const isTerminalStatus = (status: string): boolean => {
    return ['delivered', 'returned', 'cancelled', 'lost', 'destroyed',
      'rechazado', 'no_entregado', 'expired'].includes(status);
  };

  const getNoActionsMessage = (status: string, originBranch?: { name: string; address: string; hours?: string } | null): string => {
    const branchContact = originBranch
      ? `\n\n📍 Sucursal de origen: ${originBranch.name}\n📫 Dirección: ${originBranch.address}` +
        (originBranch.hours ? `\n🕐 Horarios: ${originBranch.hours}` : '')
      : '\n\nComunicate con la sucursal de origen para más información.';

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
      case 'lost':
        return '🔍 Tu envío fue declarado extraviado. Estamos investigando su paradero.' + branchContact;
      case 'destroyed':
        return '⚠️ Tu envío sufrió daño total durante el transporte. Por favor contactá la sucursal de origen para gestionar el reclamo correspondiente.' + branchContact;
      default:
        return 'No hay acciones disponibles para tu envío en este momento. Comunicate con la sucursal de origen para más información.' + branchContact;
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
      'returned': 'Devuelto',
      'lost': 'Extraviado',
      'destroyed': 'Daño total',
      'rechazado': 'Rechazado',
      'no_entregado': 'No entregado',
      'expired': 'Expirado',
    };
    return statusMap[status] || status;
  };

  const formatDate = (dateStr: string): string => fmtDate(dateStr);

  const isSessionWarning = timeRemaining < 20 && sessionActive && state === 'authenticated';

  return (
    <>
      {/* Botón flotante */}
      <Button
        size="icon"
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-[var(--brand)] text-white text-2xl shadow-lg hover:shadow-xl z-50 transition-all max-sm:right-4 max-sm:bottom-4"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Abrir chat"
      >
        {isOpen ? <X size={20} /> : <MessageCircle size={20} />}
      </Button>

      {/* Ventana del chat */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 w-[360px] max-h-[600px] bg-white rounded-2xl shadow-2xl flex flex-col z-50 overflow-hidden border border-gray-200 max-sm:right-4 max-sm:bottom-20 max-sm:w-[calc(100vw-32px)] max-sm:max-h-[calc(100vh-120px)]">
          <div className="bg-[var(--brand)] text-white p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bot size={18} />
              <div>
                <h3 className="text-sm font-bold m-0">Asistente LogiTrack</h3>
                <span className={`text-xs opacity-80 font-medium flex items-center gap-1 ${isSessionWarning ? 'animate-pulse !opacity-100' : ''}`}>
                  {loading
                    ? <><Loader size={12} className="animate-spin" /> Procesando...</>
                    : sessionActive && state === 'authenticated'
                      ? <><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Sesión activa ({timeRemaining}s)</>
                      : <><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> En línea</>}
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20 rounded-full"
              onClick={() => {
                setIsOpen(false);
                if (sessionTimeoutRef.current) {
                  clearTimeout(sessionTimeoutRef.current);
                }
              }}
              aria-label="Cerrar chat"
            >
              <X size={16} />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
            {messages.map(message => (
              <ChatMessageComponent
                key={message.id}
                message={message}
                onOptionClick={handleOptionClick}
              />
            ))}
            {loading && (
              <div className="flex items-center gap-1 px-3 py-2 w-fit">
                <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '200ms' }} />
                <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '400ms' }} />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <ChatInput
            onSend={handleUserInput}
            disabled={
              loading ||
              state === 'authenticated' ||
              state === 'claim_evidence' ||
              state === 'claim_damage_subtypes' ||
              state === 'claim_response_evidence' ||
              (state === 'authenticating' && !!trackingId && !awaitingDni)
            }
            placeholder={
              state === 'authenticated'
                ? 'Selecciona una opción...'
                : state === 'claim_evidence' || state === 'claim_response_evidence'
                  ? 'Seleccioná un archivo o usá las opciones...'
                  : 'Escribe tu respuesta...'
            }
            showFileUpload={state === 'claim_evidence' || state === 'claim_response_evidence'}
            fileUploadDisabled={loading}
            onFileSelect={(file) => {
              addUserMessage(`📎 ${file.name}`);

              if (state === 'claim_response_evidence') {
                setPendingEvidenceFile(file);
                addBotMessage(
                  `📎 Archivo seleccionado: **${file.name}**\n\n¿Confirmás que querés adjuntarlo a tu respuesta?`,
                  [
                    { label: '✅ Confirmar y enviar respuesta', value: 'confirm', action: 'confirm_claim_response' as const },
                    { label: '🔄 Cambiar archivo', value: 'change', action: 'skip_claim_response_evidence' as const },
                  ]
                );
              } else {
                setClaimEvidenceFile(file);
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
              }
            }}
          />
        </div>
      )}
    </>
  );
};
