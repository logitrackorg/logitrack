import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy, User, ChevronLeft, ChevronRight, PowerOff } from "lucide-react";
import { eomApi, categoryLabel, type EOMWinner, type EOMCategory } from "../../api/employeeOfMonth";
import { usersApi, type UserProfile } from "../../api/users";
import { branchApi, type Branch } from "../../api/branches";

interface Props {
  branchId: string;
}

const CATEGORIES: EOMCategory[] = ["last_mile_driver", "operator", "inter_branch_driver"];

function WinnerRow({
  winner,
  showBranch,
  branchDisplayName,
}: {
  winner: EOMWinner;
  showBranch: boolean;
  branchDisplayName: string;
}) {
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (winner.has_winner && winner.user_id) {
      usersApi.getById(winner.user_id).then(setProfile).catch(() => null);
    }
  }, [winner.user_id, winner.has_winner]);

  const name = profile?.full_name ?? winner.user_id ?? "—";

  if (!winner.has_winner) {
    return (
      <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-[var(--bg-subtle,#f8fafc)]">
        {showBranch && (
          <span className="text-xs font-semibold text-[var(--text-secondary)] w-28 shrink-0 truncate">
            {branchDisplayName}
          </span>
        )}
        <span className="text-sm text-[var(--text-muted,#94a3b8)] italic">Sin ganador este mes</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-[var(--bg-subtle,#f8fafc)] hover:bg-amber-50/60 transition-colors">
      {showBranch && (
        <span className="text-xs font-semibold text-[var(--text-secondary)] w-28 shrink-0 truncate" title={branchDisplayName}>
          {branchDisplayName}
        </span>
      )}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{ background: "linear-gradient(135deg,#fbbf24,#f59e0b)" }}
      >
        <User size={15} color="#78350f" />
      </div>
      <div className="flex-1 min-w-0">
        {winner.user_id ? (
          <Link
            to={`/employees/${winner.user_id}`}
            className="font-semibold text-sm text-[var(--brand,#3b82f6)] hover:underline truncate block"
          >
            {name}
          </Link>
        ) : (
          <span className="font-semibold text-sm truncate block">{name}</span>
        )}
        {!showBranch && profile?.branch_name && (
          <span className="text-xs text-[var(--text-muted,#64748b)]">{profile.branch_name}</span>
        )}
      </div>
      <div className="flex items-baseline gap-1 shrink-0">
        <span className="text-xl font-extrabold text-amber-500">
          {winner.score?.toFixed(1) ?? "—"}
        </span>
        <span className="text-xs text-[var(--text-muted,#64748b)]">pts</span>
      </div>
      {winner.activity_count != null && winner.activity_count > 0 && (
        <div className="shrink-0 text-right hidden sm:block">
          <span className="text-xs text-[var(--text-muted,#64748b)]">{winner.activity_count} act.</span>
        </div>
      )}
    </div>
  );
}

function CategorySection({
  category,
  winners,
  showBranch,
  branchNameById,
}: {
  category: EOMCategory;
  winners: EOMWinner[];
  showBranch: boolean;
  branchNameById: (id: string) => string;
}) {
  if (winners.length === 0) return null;

  return (
    <div className="flex-1" style={{ minWidth: 280 }}>
      <div className="flex items-center gap-2 mb-3">
        <Trophy size={16} color="#f59e0b" />
        <h3 className="m-0 font-bold text-sm uppercase tracking-wide text-[var(--text-secondary)]">
          {categoryLabel(category)}
        </h3>
      </div>
      <div className="flex flex-col gap-1.5">
        {winners.map((w) => (
          <WinnerRow
            key={`${w.category}|${w.branch_id}`}
            winner={w}
            showBranch={showBranch}
            branchDisplayName={branchNameById(w.branch_id)}
          />
        ))}
      </div>
    </div>
  );
}

function periodLabel(period: string): string {
  if (!period) return "";
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1).toLocaleDateString("es-AR", { year: "numeric", month: "long" });
}

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function prevMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function EmpleadoMesTab({ branchId }: Props) {
  const [winners, setWinners] = useState<EOMWinner[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<string>(currentYearMonth());

  useEffect(() => {
    branchApi.list().then(setBranches).catch(() => null);
  }, []);

  const currentBranch = branchId ? branches.find((b) => b.id === branchId) : null;
  const featureDisabled = currentBranch != null && !currentBranch.employee_of_month_enabled;

  // When the feature is disabled, lock navigation to past months only.
  const today = currentYearMonth();
  const isCurrentPeriod = selectedPeriod === today;
  const canGoNext = !featureDisabled && selectedPeriod < today;

  // If feature just became disabled and user was on current month, shift back one month.
  useEffect(() => {
    if (featureDisabled && selectedPeriod === today) {
      setSelectedPeriod(prevMonth(today));
    }
  }, [featureDisabled, selectedPeriod, today]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    eomApi
      .getWinners(selectedPeriod, branchId || undefined)
      .then((data) => {
        setWinners(data.winners ?? []);
      })
      .catch(() => setError("No se pudo cargar el Empleado del Mes."))
      .finally(() => setLoading(false));
  }, [branchId, selectedPeriod]);

  const branchNameById = (id: string): string => {
    if (!id) return "Red";
    return branches.find((b) => b.id === id)?.name ?? id;
  };

  const showBranch = !branchId;

  const byCategory = new Map<EOMCategory, EOMWinner[]>();
  for (const cat of CATEGORIES) byCategory.set(cat, []);
  for (const w of winners) {
    byCategory.get(w.category)?.push(w);
  }

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
        <div className="flex items-center gap-2.5">
          <Trophy size={22} color="#f59e0b" />
          <h2 className="m-0 font-bold text-lg">Empleado del Mes</h2>
        </div>

        {/* Period navigator */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSelectedPeriod(prevMonth(selectedPeriod))}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
            aria-label="Mes anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-medium text-slate-700 dark:text-gray-200 min-w-[130px] text-center capitalize">
            {periodLabel(selectedPeriod)}
          </span>
          <button
            onClick={() => setSelectedPeriod(nextMonth(selectedPeriod))}
            disabled={!canGoNext}
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
              canGoNext
                ? "text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-700 cursor-pointer"
                : "text-slate-300 dark:text-gray-600 cursor-not-allowed"
            }`}
            aria-label="Mes siguiente"
          >
            <ChevronRight size={16} />
          </button>
          {!featureDisabled && !isCurrentPeriod && (
            <button
              onClick={() => setSelectedPeriod(today)}
              className="ml-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              Hoy
            </button>
          )}
        </div>
      </div>

      {/* Disabled banner */}
      {featureDisabled && (
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800/60 px-4 py-3 mb-5">
          <PowerOff size={18} className="text-slate-400 dark:text-gray-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-slate-700 dark:text-gray-200">
              Funcionalidad no disponible en esta sucursal
            </p>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              La sucursal <strong>{currentBranch.name}</strong> no tiene habilitado el programa de Empleado del Mes.
              A continuación podés consultar el historial de períodos anteriores.
            </p>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="p-8 text-center text-[var(--text-muted,#64748b)] text-sm">Cargando...</div>
      ) : error ? (
        <div className="p-8 text-center text-red-500 text-sm">{error}</div>
      ) : winners.length === 0 ? (
        <p className="text-sm text-[var(--text-muted,#64748b)]">
          No hay resultados para este período.
        </p>
      ) : (
        <div className="flex flex-wrap gap-6">
          {CATEGORIES.map((cat) => (
            <CategorySection
              key={cat}
              category={cat}
              winners={byCategory.get(cat) ?? []}
              showBranch={showBranch && cat !== "inter_branch_driver"}
              branchNameById={branchNameById}
            />
          ))}
        </div>
      )}
    </div>
  );
}
