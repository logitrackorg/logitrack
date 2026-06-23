// Árbol de pre-filtro guiado de reclamos.
// Lógica pura compartida entre el chatbot y el formulario público.
// No tiene dependencias de React ni de API.

import type { ClaimCategory, DamageSubtype } from './claimDecisionTree';

export interface PreFilterCtx {
  status: string;
  estimated_delivery_at?: string | null;
}

// Hoja: resultado final de un camino del árbol
export type PreFilterLeaf =
  | {
      kind: 'continue';
      prefillDamageSubtypes?: DamageSubtype[];
      noteMessage?: string;
    }
  | { kind: 'resolved'; message: string }
  | { kind: 'redirect'; to: ClaimCategory };

// Nodo interno: pregunta con opciones
export interface PreFilterNode {
  question: string;
  options: Array<{ label: string; value: string }>;
  next(answer: string, ctx: PreFilterCtx): PreFilterNode | PreFilterLeaf;
}

export type PreFilterStep = PreFilterNode | PreFilterLeaf;

export function isLeaf(step: PreFilterStep): step is PreFilterLeaf {
  return 'kind' in step;
}

// ────────────────────────────────────────────────────────────────────────────
// Árbol: Daño / Faltante
// ────────────────────────────────────────────────────────────────────────────

const damagePhotosNode: PreFilterNode = {
  question: '¿Tenés fotos del daño para adjuntar como evidencia?',
  options: [
    { label: '📷 Sí, tengo fotos', value: 'yes' },
    { label: '📵 No tengo fotos', value: 'no' },
  ],
  next(answer) {
    if (answer === 'yes') {
      return { kind: 'continue', prefillDamageSubtypes: ['product_damaged'] };
    }
    return {
      kind: 'continue',
      prefillDamageSubtypes: ['product_damaged'],
      noteMessage:
        'Te recomendamos sacar fotos del daño antes de avanzar: facilitará la resolución del reclamo.',
    };
  },
};

const damagePackagingNode: PreFilterNode = {
  question: '¿Querés reportar el daño del embalaje de todos modos?',
  options: [
    { label: '✅ Sí, reportar', value: 'yes' },
    { label: '❌ No', value: 'no' },
  ],
  next(answer) {
    if (answer === 'yes') {
      return { kind: 'continue', prefillDamageSubtypes: ['packaging_damaged'] };
    }
    return { kind: 'resolved', message: 'Entendido. No se abrió ningún reclamo.' };
  },
};

const damageInteriorNode: PreFilterNode = {
  question: '¿El daño afectó al producto interior?',
  options: [
    { label: '✅ Sí, el producto está dañado', value: 'yes' },
    { label: '❌ No, solo el embalaje', value: 'no' },
  ],
  next(answer) {
    return answer === 'yes' ? damagePhotosNode : damagePackagingNode;
  },
};

const damageVisibleNode: PreFilterNode = {
  question: '¿El paquete llegó con daños visibles o te falta mercadería?',
  options: [
    { label: '✅ Sí', value: 'yes' },
    { label: '❌ No', value: 'no' },
  ],
  next(answer) {
    if (answer === 'yes') return damageInteriorNode;
    return { kind: 'resolved', message: 'Sin daños ni faltantes reportados. No se abrió ningún reclamo.' };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Árbol: Demora
// ────────────────────────────────────────────────────────────────────────────

function etaPassed(ctx: PreFilterCtx): boolean {
  if (!ctx.estimated_delivery_at) return true;
  return new Date(ctx.estimated_delivery_at).getTime() < Date.now();
}

function buildDelayOverrideNode(message: string): PreFilterNode {
  return {
    question: message,
    options: [
      { label: '📋 Sí, abrir reclamo', value: 'yes' },
      { label: '⏳ No, esperar un poco más', value: 'no' },
    ],
    next(answer) {
      if (answer === 'yes') return { kind: 'continue' };
      return {
        kind: 'resolved',
        message: 'De acuerdo. Podés volver a reportarlo si el problema persiste.',
      };
    },
  };
}

export function getDelayPreFilter(ctx: PreFilterCtx): PreFilterStep {
  if (!etaPassed(ctx)) {
    return {
      kind: 'resolved',
      message:
        'Tu envío está dentro del plazo estimado de entrega. Si la demora persiste podés abrir un reclamo más adelante.',
    };
  }
  if (ctx.status === 'out_for_delivery') {
    return buildDelayOverrideNode(
      'Tu envío está con el repartidor en este momento. Demoras de hasta 24–48 h en última milla son normales. ¿Querés abrir el reclamo igual?',
    );
  }
  if (ctx.status === 'at_hub') {
    return buildDelayOverrideNode(
      'Tu envío llegó a la sucursal de destino. Puede tardar hasta 24–48 h en programarse para entrega. ¿Querés abrir el reclamo igual?',
    );
  }
  return { kind: 'continue' };
}

// ────────────────────────────────────────────────────────────────────────────
// Árbol: No lo recibí (delivery_problem)
// ────────────────────────────────────────────────────────────────────────────

const notDeliveredNeighborsNode: PreFilterNode = {
  question:
    '¿Ya verificaste con vecinos, portería o personas del hogar si recibieron el paquete?',
  options: [
    { label: '✅ Sí, ya verifiqué', value: 'yes' },
    { label: '❌ Todavía no', value: 'no' },
  ],
  next(answer) {
    if (answer === 'yes') {
      return {
        kind: 'continue',
        noteMessage:
          'Revisá también la foto adjunta de la entrega y el horario registrado. En caso de tener dudas, avanzá con el reclamo.',
      };
    }
    return {
      kind: 'resolved',
      message:
        'Te pedimos que verifiques con vecinos, portería o personas del hogar antes de abrir el reclamo. Si confirmás que no lo tienen, volvé a intentarlo.',
    };
  },
};

export function getNotDeliveredPreFilter(ctx: PreFilterCtx): PreFilterStep {
  if (ctx.status !== 'delivered') {
    return { kind: 'redirect', to: 'delivery_delay' };
  }
  return notDeliveredNeighborsNode;
}

// ────────────────────────────────────────────────────────────────────────────
// Árbol: Maltrato del personal
// ────────────────────────────────────────────────────────────────────────────

const badTreatmentNode: PreFilterNode = {
  question: '¿El incidente ocurrió con un repartidor durante la entrega o con personal en una sucursal?',
  options: [
    { label: '🚚 Con el repartidor', value: 'driver' },
    { label: '🏢 En sucursal', value: 'branch' },
  ],
  next(answer) {
    const who = answer === 'driver' ? 'el repartidor' : 'personal de la sucursal';
    return {
      kind: 'continue',
      noteMessage: `Tu reclamo sobre ${who} será revisado por el equipo de supervisión en un plazo de 24 horas hábiles.`,
    };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Árbol: Otro
// ────────────────────────────────────────────────────────────────────────────

export function getOtherPreFilter(branchContact?: string): PreFilterNode {
  return {
    question: '¿Tu consulta está relacionada directamente con este envío?',
    options: [
      { label: '✅ Sí, está relacionada', value: 'yes' },
      { label: '❌ No, es otra consulta', value: 'no' },
    ],
    next(answer) {
      if (answer === 'yes') return { kind: 'continue' };
      const msg = branchContact
        ? `Comunicate con la sucursal de origen: ${branchContact}`
        : 'Comunicate con la sucursal de origen para más información.';
      return { kind: 'resolved', message: msg };
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────────────────────

export function getPreFilterRoot(
  category: ClaimCategory,
  ctx: PreFilterCtx,
  branchContact?: string,
): PreFilterStep {
  switch (category) {
    case 'incomplete_damage':
      return damageVisibleNode;
    case 'delivery_delay':
      return getDelayPreFilter(ctx);
    case 'delivery_problem':
      return getNotDeliveredPreFilter(ctx);
    case 'staff_conduct':
      return badTreatmentNode;
    case 'other':
      return getOtherPreFilter(branchContact);
  }
}
