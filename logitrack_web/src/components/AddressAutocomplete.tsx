import { useEffect, useRef, useState } from "react";

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address: {
    road?: string;
    house_number?: string;
    city?: string;
    town?: string;
    village?: string;
    suburb?: string;
    neighbourhood?: string;
    state?: string;
    postcode?: string;
  };
}

export interface AddressParts {
  street: string;
  city: string;
  province: string;
  postal_code: string;
  latitude?: number;
  longitude?: number;
}

const PROVINCES = [
  "Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes",
  "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza",
  "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis",
  "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán",
];

function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function matchProvince(state?: string): string {
  if (!state) return "";
  const n = norm(state);
  if (n.includes("ciudad autonoma") || n.includes("caba")) return "Buenos Aires";
  const exact = PROVINCES.find(p => norm(p) === n);
  if (exact) return exact;
  const partial = PROVINCES.find(p => n.includes(norm(p)) || norm(p).includes(n));
  return partial ?? "";
}

function formatLabel(r: NominatimResult): string {
  const a = r.address;
  const parts: string[] = [];
  if (a.road) parts.push([a.road, a.house_number].filter(Boolean).join(" "));
  const locality = a.city ?? a.town ?? a.village ?? a.suburb;
  if (locality) parts.push(locality);
  if (a.state) parts.push(a.state);
  return parts.join(", ") || r.display_name;
}

function parseResult(r: NominatimResult): AddressParts {
  const a = r.address;
  const street = [a.road, a.house_number].filter(Boolean).join(" ");
  const city = a.city ?? a.town ?? a.village ?? a.suburb ?? a.neighbourhood ?? "";
  const lat = parseFloat(r.lat);
  const lon = parseFloat(r.lon);
  return {
    street,
    city,
    province: matchProvince(a.state),
    postal_code: a.postcode ?? "",
    latitude: isNaN(lat) ? undefined : lat,
    longitude: isNaN(lon) ? undefined : lon,
  };
}

async function searchNominatim(query: string): Promise<NominatimResult[]> {
  try {
    const q = `${query}, Argentina`;
    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?q=${encodeURIComponent(q)}&countrycodes=ar&format=json&addressdetails=1&limit=5`;
    const res = await fetch(url, { headers: { "Accept-Language": "es" } });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

interface Props {
  value: string | undefined;
  onChange: (street: string) => void;
  onAddressSelect: (parts: AddressParts) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  required?: boolean;
}

export function AddressAutocomplete({ value: valueProp, onChange, onAddressSelect, placeholder, style, required }: Props) {
  const value = valueProp ?? "";
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const justSelectedRef = useRef(false);
  const userTypedRef = useRef(false);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      return;
    }
    if (!userTypedRef.current) {
      return;
    }
    userTypedRef.current = false;
    if (value.length < 5) {
      setSuggestions([]);
      setOpen(false);
      setNotFound(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      setNotFound(false);
      const results = await searchNominatim(value);
      setSuggestions(results);
      setOpen(results.length > 0);
      setNotFound(results.length === 0);
      setLoading(false);
    }, 400);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (r: NominatimResult) => {
    const parts = parseResult(r);
    justSelectedRef.current = true;
    onChange(parts.street);
    onAddressSelect(parts);
    setOpen(false);
    setSuggestions([]);
    setNotFound(false);
  };

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <input
        style={style}
        value={value}
        required={required}
        onChange={(e) => { userTypedRef.current = true; onChange(e.target.value); }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {loading && (
        <span style={{
          position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
          fontSize: 11, color: "#9ca3af", pointerEvents: "none",
        }}>
          buscando...
        </span>
      )}
      {open && suggestions.length > 0 && (
        <ul style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100,
          background: "#fff", border: "1px solid #d1d5db", borderRadius: 8,
          margin: 0, padding: 0, listStyle: "none",
          boxShadow: "0 4px 12px rgba(0,0,0,0.12)", maxHeight: 220, overflowY: "auto",
        }}>
          {suggestions.map((r) => (
            <li
              key={r.place_id}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(r); }}
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid #f3f4f6" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f9ff")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
            >
              {formatLabel(r)}
            </li>
          ))}
        </ul>
      )}
      {notFound && !loading && (
        <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af" }}>
          No se encontró la dirección. Podés completar los campos manualmente.
        </p>
      )}
    </div>
  );
}
