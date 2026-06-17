import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Mock BottomSheet ──────────────────────────────────────────
vi.mock("@/components/ui/bottom-sheet", () => ({
  BottomSheet: ({
    open,
    title,
    description,
    children,
  }: {
    open: boolean;
    onClose: () => void;
    title: string;
    description?: string;
    children: React.ReactNode;
  }) =>
    open ? (
      <div data-testid="bottom-sheet">
        <h2 data-testid="sheet-title">{title}</h2>
        {description && <p data-testid="sheet-desc">{description}</p>}
        <div data-testid="sheet-content">{children}</div>
      </div>
    ) : null,
}));

// ── Mock Button ───────────────────────────────────────────────
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    className,
    disabled,
    onClick,
    ...props
  }: React.ComponentProps<"button"> & {
    'data-testid'?: string;
  }) => (
    <button
      data-testid={props['data-testid']}
      disabled={disabled}
      onClick={onClick}
      className={className}
    >
      {children}
    </button>
  ),
}));

// ── Mock cn ───────────────────────────────────────────────────
vi.mock("@/lib/utils", () => ({
  cn: (...args: (string | undefined | false | null)[]) =>
    args.filter(Boolean).join(" "),
}));

// ── Mock driverActions ────────────────────────────────────────
vi.mock("@/utils/driverActions", () => {
  const StubIcon = () => null;
  return {
    recipientView: (s: { recipient?: { name: string } }) => ({
      name: s.recipient?.name ?? "Cliente",
      phone: "",
      street: "",
      city: "",
      province: "",
      postal: "",
      fullAddress: "",
      specialInstructions: "",
    }),
    FAILED_REASONS: [
      { id: "ausente", label: "Ausente" },
      { id: "direccion_incorrecta", label: "Dirección incorrecta" },
      { id: "sin_acceso", label: "Sin acceso" },
      { id: "otro", label: "Otro" },
    ],
    REJECTED_REASONS: [
      { id: "no_lo_pedi", label: "No lo pedí", icon: StubIcon },
      { id: "no_lo_quiero", label: "No lo quiero", icon: StubIcon },
      { id: "producto_danado", label: "Producto dañado", icon: StubIcon },
      { id: "llego_tarde", label: "Llegó demasiado tarde", icon: StubIcon },
      { id: "no_coincide_pedido", label: "No coincide con el pedido", icon: StubIcon },
      { id: "otro", label: "Otro", icon: StubIcon },
    ],
  };
});

// ── Component under test ──────────────────────────────────────
import { DeliveryActionSheet } from "../components/driver/DeliveryActionSheet";

// ── Helpers ───────────────────────────────────────────────────

const baseProps = {
  open: true,
  onClose: vi.fn(),
  submitting: false,
  onConfirm: vi.fn(),
  speedBlocked: false,
  blockMessage: "",
  needsLocation: false,
  onRequestLocation: vi.fn(),
  error: "",
};

function makeShipment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tracking_id: "LT-TEST0001",
    recipient: { name: "Juan Pérez", phone: "1123456789" },
    delivery_method: "ultima_milla",
    keyword_attempts: 0,
    ...overrides,
  } as unknown as import("../api/shipments").Shipment;
}

// ── Tests ─────────────────────────────────────────────────────

describe("DeliveryActionSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deliver mode renders keyword input", () => {
    render(
      <DeliveryActionSheet
        {...baseProps}
        mode="deliver"
        shipment={makeShipment()}
        keyword=""
        onKeywordChange={vi.fn()}
        dni=""
        onDniChange={vi.fn()}
      />,
    );

    // Title and description
    expect(screen.getByTestId("sheet-title")).toHaveTextContent("Confirmar entrega");
    expect(screen.getByText("Entrega a Juan Pérez")).toBeInTheDocument();

    // Keyword input
    expect(
      screen.getByPlaceholderText("Dictada por el destinatario"),
    ).toBeInTheDocument();

    // Confirm button (title also has "Confirmar entrega" so getAllByText)
    const confirmEls = screen.getAllByText("Confirmar entrega");
    expect(confirmEls.length).toBeGreaterThanOrEqual(2);
  });

  it("failed mode renders reason grid", () => {
    render(
      <DeliveryActionSheet
        {...baseProps}
        mode="failed"
        shipment={makeShipment()}
        reason=""
        onReasonChange={vi.fn()}
        notes=""
        onNotesChange={vi.fn()}
      />,
    );

    // Title
    expect(screen.getByText("Marcar como no entregado")).toBeInTheDocument();

    // All 4 reason buttons
    expect(screen.getByText("Ausente")).toBeInTheDocument();
    expect(screen.getByText("Dirección incorrecta")).toBeInTheDocument();
    expect(screen.getByText("Sin acceso")).toBeInTheDocument();
    expect(screen.getByText("Otro")).toBeInTheDocument();

    // Confirm button
    expect(screen.getByText("Confirmar")).toBeInTheDocument();
  });

  it("rejected mode renders reason grid with icons", () => {
    render(
      <DeliveryActionSheet
        {...baseProps}
        mode="rejected"
        shipment={makeShipment()}
        reason=""
        onReasonChange={vi.fn()}
        notes=""
        onNotesChange={vi.fn()}
      />,
    );

    // Title
    expect(screen.getByText("Rechazo por destinatario")).toBeInTheDocument();

    // All 6 reason buttons
    expect(screen.getByText("No lo pedí")).toBeInTheDocument();
    expect(screen.getByText("No lo quiero")).toBeInTheDocument();
    expect(screen.getByText("Producto dañado")).toBeInTheDocument();
    expect(screen.getByText("Llegó demasiado tarde")).toBeInTheDocument();
    expect(screen.getByText("No coincide con el pedido")).toBeInTheDocument();
    expect(screen.getByText("Otro")).toBeInTheDocument();

    // Confirm button
    expect(screen.getByText("Confirmar rechazo")).toBeInTheDocument();
  });

  it("deliver mode shows contingency UI when useContingency=true", () => {
    render(
      <DeliveryActionSheet
        {...baseProps}
        mode="deliver"
        shipment={makeShipment({ keyword_attempts: 3 })}
        keyword=""
        onKeywordChange={vi.fn()}
        useContingency={true}
        onUseContingency={vi.fn()}
        dni=""
        onDniChange={vi.fn()}
      />,
    );

    // Contingency alert
    expect(screen.getByText("Entrega de contingencia")).toBeInTheDocument();
    expect(
      screen.getByText(
        "El registro quedará marcado para auditoría del supervisor.",
      ),
    ).toBeInTheDocument();

    // DNI input (instead of keyword)
    expect(screen.getByPlaceholderText("Ej: 30123456")).toBeInTheDocument();

    // "Volver a intentar con palabra clave" button
    expect(
      screen.getByText("Volver a intentar con palabra clave"),
    ).toBeInTheDocument();
  });

  it("deliver mode shows locked warning when keyword_attempts >= 3", () => {
    render(
      <DeliveryActionSheet
        {...baseProps}
        mode="deliver"
        shipment={makeShipment({ keyword_attempts: 3 })}
        keyword=""
        onKeywordChange={vi.fn()}
        dni=""
        onDniChange={vi.fn()}
      />,
    );

    // Locked warning
    expect(
      screen.getByText("Campo bloqueado — 3 intentos fallidos"),
    ).toBeInTheDocument();

    // "Entregar con DNI" button
    expect(screen.getByText("Entregar con DNI")).toBeInTheDocument();
  });
});
