// fatigueWizardProgress — persiste en sessionStorage el paso del wizard de
// prueba de fatiga (KssCheckIn) en el que quedó el chofer.
//
// Por qué hace falta: SubmitCheckin (paso "kss") persiste el check-in en el
// backend y resetea el contador de inicios de ruta ANTES de que se completen
// los pasos de voz y PVT. Si el chofer recarga la página justo después de eso,
// el gate (getCheckinGateStatus / getTodayCheckin) ya reporta "test no
// requerido" — permitiendo saltear voz y PVT por completo. Esta persistencia
// permite que las pantallas que montan el gate fuercen su reaparición aunque
// el backend ya no lo exija, y que KssCheckIn retome exactamente donde quedó.

export type FatigueWizardStep = "kss" | "voice" | "pvt";

const STORAGE_PREFIX = "fatigue_wizard_pending_";

function isWizardStep(value: string | null): value is FatigueWizardStep {
  return value === "kss" || value === "voice" || value === "pvt";
}

export function getPendingFatigueStep(driverId: string): FatigueWizardStep | null {
  const raw = sessionStorage.getItem(STORAGE_PREFIX + driverId);
  return isWizardStep(raw) ? raw : null;
}

export function setPendingFatigueStep(driverId: string, step: FatigueWizardStep): void {
  sessionStorage.setItem(STORAGE_PREFIX + driverId, step);
}

export function clearPendingFatigueStep(driverId: string): void {
  sessionStorage.removeItem(STORAGE_PREFIX + driverId);
}
