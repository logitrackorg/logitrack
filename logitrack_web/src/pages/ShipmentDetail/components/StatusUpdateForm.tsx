import type { Shipment, ShipmentEvent, ShipmentStatus } from "../../../api/shipments";
import type { UserProfile } from "../../../api/users";
import type { Branch } from "../../../api/branches";
import { branchLabel } from "../../../api/branches";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { FormField } from "../../../components/ui/form-field/FormField";

interface StatusUpdateFormProps {
  nextStatuses: ShipmentStatus[];
  newStatus: ShipmentStatus | "";
  onStatusSelect: (status: ShipmentStatus) => void;
  selectedDriverId: string;
  onDriverChange: (id: string) => void;
  drivers: UserProfile[];
  recipientDni: string;
  onRecipientDniChange: (dni: string) => void;
  senderDni: string;
  onSenderDniChange: (dni: string) => void;
  notes: string;
  onNotesChange: (notes: string) => void;
  updating: boolean;
  updateError: string;
  onSubmit: (e: React.FormEvent) => void;
  shipment: Shipment;
  events: ShipmentEvent[];
  branches: Branch[];
  statusLabels: Record<ShipmentStatus, string>;
}

const fieldInputClass =
  "w-full px-3 py-2 rounded-lg border border-[var(--border-strong)] text-sm bg-[var(--bg-card)] text-[var(--text-primary)] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 placeholder:text-[var(--text-muted)]";

const statusBtnBase =
  "px-4 py-1.5 rounded-md cursor-pointer text-[13px] font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed";

const statusBtnSelected =
  "ring-2 ring-offset-1 ring-[var(--text-heading)] shadow-sm border-2 border-[var(--text-heading)] bg-[var(--brand-tint)] text-[var(--text-heading)] dark:bg-[var(--brand-tint)] dark:text-[var(--text-heading)] dark:border-[var(--text-heading)]";

const statusBtnUnselected =
  "border border-[var(--border-strong)] bg-[var(--bg-card)] text-[var(--text-strong)] hover:border-[var(--text-muted)] hover:bg-[var(--bg-subtle)] dark:border-[var(--border-strong)] dark:bg-[var(--bg-card)] dark:text-[var(--text-primary)] dark:hover:border-[var(--text-muted)] dark:hover:bg-[var(--bg-muted)]";

export function StatusUpdateForm({
  nextStatuses,
  newStatus,
  onStatusSelect,
  selectedDriverId,
  onDriverChange,
  drivers,
  recipientDni,
  onRecipientDniChange,
  senderDni,
  onSenderDniChange,
  notes,
  onNotesChange,
  updating,
  updateError,
  onSubmit,
  shipment,
  events,
  branches,
  statusLabels,
}: StatusUpdateFormProps) {
  return (
    <Card className="mb-4 border-l-4 border-l-[var(--accent)] dark:border-l-[var(--accent)]">
      <CardHeader className="pb-3">
        <CardTitle>Actualizar estado</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-3">
          <div className="flex gap-2 flex-wrap">
            {nextStatuses.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onStatusSelect(s)}
                disabled={updating}
                className={`${statusBtnBase} ${newStatus === s ? statusBtnSelected : statusBtnUnselected}`}
              >
                {statusLabels[s]}
              </button>
            ))}
          </div>

          {newStatus === "out_for_delivery" && (
            <FormField label="Chofer" required>
              <select
                value={selectedDriverId}
                onChange={(e) => onDriverChange(e.target.value)}
                required
                className={fieldInputClass}
              >
                <option value="">Seleccioná un chofer (obligatorio)</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.username}</option>
                ))}
              </select>
            </FormField>
          )}

          {newStatus === "delivered" && (
            <FormField label="DNI del destinatario" required>
              <input
                value={recipientDni}
                onChange={(e) => onRecipientDniChange(e.target.value)}
                placeholder="DNI del destinatario (obligatorio)"
                required
                className={fieldInputClass}
              />
            </FormField>
          )}

          {newStatus === "returned" && !shipment.parent_shipment_id && (
            <FormField label="DNI del remitente" required>
              <input
                value={senderDni}
                onChange={(e) => onSenderDniChange(e.target.value)}
                placeholder="DNI del remitente (obligatorio)"
                required
                className={fieldInputClass}
              />
            </FormField>
          )}

          {newStatus === "returned" && !!shipment.parent_shipment_id && (
            <FormField label="DNI del destinatario (remitente original)" required>
              <input
                value={recipientDni}
                onChange={(e) => onRecipientDniChange(e.target.value)}
                placeholder="DNI del destinatario -remitente original- (obligatorio)"
                required
                className={fieldInputClass}
              />
            </FormField>
          )}

          {newStatus === "at_hub" && shipment.status === "delivery_failed" && (() => {
            const returnLocation = [...events].reverse().find(ev => ev.to_status === "at_hub")?.location;
            return returnLocation ? (
              <p className="m-0 text-[13px] text-[var(--text-secondary)] dark:text-[var(--text-muted)]">
                Devolviendo a: <strong>{branchLabel(returnLocation, branches)}</strong>
              </p>
            ) : null;
          })()}

          <FormField
            label="Notas"
            required={newStatus === "delivery_failed"}
            error={newStatus === "delivery_failed" && !notes.trim() ? "El motivo es obligatorio para registrar un intento fallido." : undefined}
          >
            <input
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder={newStatus === "delivery_failed" ? "Motivo obligatorio (ej: destinatario ausente)" : "Notas (opcional)"}
              required={newStatus === "delivery_failed"}
              className={fieldInputClass}
            />
          </FormField>

          {updateError && (
            <p className="text-[var(--danger-c)] dark:text-[var(--danger-text)] m-0 text-[13px] font-medium">
              {updateError}
            </p>
          )}

          <div className="flex justify-end mt-1">
            {(() => {
              const returnedDniMissing = newStatus === "returned" && (shipment.parent_shipment_id ? !recipientDni.trim() : !senderDni.trim());
              const disabled = !newStatus || updating || (newStatus === "delivery_failed" && !notes.trim()) || (newStatus === "out_for_delivery" && !selectedDriverId) || (newStatus === "delivered" && !recipientDni.trim()) || returnedDniMissing;
              return (
                <Button type="submit" disabled={disabled}>
                  {updating ? "Actualizando..." : "Confirmar cambio"}
                </Button>
              );
            })()}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
