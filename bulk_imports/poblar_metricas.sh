#!/usr/bin/env bash
# Genera datos completos para el dashboard: entregas, cancelaciones, en tránsito, etc.
set -euo pipefail

API="http://localhost:8080/api/v1"

login() {
  curl -s -X POST "$API/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$1\",\"password\":\"$2\"}" \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])"
}

TOKEN_SUP=$(login "sup_caba" "sup_caba123")
TOKEN_CHOFER=$(login "chofer_caba" "chofer_caba123")

echo "📦 Creando envíos nuevos..."
IDS=()
create_and_capture() {
  local resp
  resp=$(curl -s -X POST "$API/shipments" \
    -H "Authorization: Bearer $TOKEN_SUP" \
    -H "Content-Type: application/json" \
    -d "$1")
  local tid
  tid=$(echo "$resp" | python3 -c "import sys,json;print(json.load(sys.stdin).get('tracking_id',''))" 2>/dev/null || true)
  if [ -n "$tid" ]; then
    echo "  ✓ $tid"
    IDS+=("$tid")
  else
    echo "  ✗ Error: $(echo "$resp" | python3 -c "import sys,json;print(json.load(sys.stdin).get('error','unknown'))" 2>/dev/null || echo "$resp")"
  fi
}

# ── 6 envíos para CABA (última milla) ──
for i in 1 2 3 4 5 6; do
  case $i in
    1) name="Carlos López";;
    2) name="Ana Martínez";;
    3) name="Pedro Rodríguez";;
    4) name="Lucía Fernández";;
    5) name="Jorge González";;
    6) name="María Elena Díaz";;
  esac
  create_and_capture '{
    "sender":{"dni":"20111222333","name":"Distribuidora Alimenticia SA","phone":"541155500001","address":{"street":"Av. Corrientes 3200","city":"Ciudad de Buenos Aires","province":"Buenos Aires","postal_code":"C1042"}},
    "recipient":{"dni":"3123400'$i'000","name":"'"$name"'","phone":"54119900110'$i'","address":{"street":"Av. Siempre Viva '$i'000","city":"Ciudad de Buenos Aires","province":"Buenos Aires","postal_code":"C1424","latitude":-34.61,"longitude":-58.44}},
    "weight_kg":'$((i * 3))',"package_type":"box","shipment_type":"normal","time_window":"flexible","delivery_method":"ultima_milla","receiving_branch_id":"caba"
  }'
done

# ── 4 envíos inter-sucursal ──
create_and_capture '{
  "sender":{"dni":"20111222333","name":"Distribuidora Alimenticia SA","phone":"541155500001","address":{"street":"Av. Corrientes 3200","city":"Ciudad de Buenos Aires","province":"Buenos Aires","postal_code":"C1042"}},
  "recipient":{"dni":"30222555111","name":"Distribuidora Córdoba","phone":"543514001111","address":{"street":"Av. Colón 1800","city":"Córdoba","province":"Córdoba","postal_code":"X5000","latitude":-31.4135,"longitude":-64.1852}},
  "weight_kg":85,"package_type":"box","shipment_type":"normal","time_window":"flexible","delivery_method":"ultima_milla","receiving_branch_id":"cordoba"
}'

create_and_capture '{
  "sender":{"dni":"20777888111","name":"Vinos Argentinos SA","phone":"541155500006","address":{"street":"Av. Del Libertador 6500","city":"Ciudad de Buenos Aires","province":"Buenos Aires","postal_code":"C1429"}},
  "recipient":{"dni":"30999000333","name":"Bodega Mendoza","phone":"542614001111","address":{"street":"Av. San Martín 3500","city":"Mendoza","province":"Mendoza","postal_code":"M5500","latitude":-32.888,"longitude":-68.8465}},
  "weight_kg":120,"package_type":"box","is_fragile":true,"special_instructions":"Botellas de vino","shipment_type":"express","time_window":"morning","delivery_method":"ultima_milla","receiving_branch_id":"mendoza"
}'

create_and_capture '{
  "sender":{"dni":"20555666888","name":"Indumentaria Deportiva SA","phone":"541155500004","address":{"street":"Av. Santa Fe 3800","city":"Ciudad de Buenos Aires","province":"Buenos Aires","postal_code":"C1425"}},
  "recipient":{"dni":"30666788100","name":"Almacén Posadas","phone":"543764003344","address":{"street":"Av. San Martín 1800","city":"Posadas","province":"Misiones","postal_code":"N3300","latitude":-27.3645,"longitude":-55.8867}},
  "weight_kg":22,"package_type":"box","shipment_type":"normal","time_window":"flexible","delivery_method":"ultima_milla","receiving_branch_id":"posadas"
}'

# ── 2 envíos retiro sucursal ──
create_and_capture '{
  "sender":{"dni":"20111000333","name":"Tienda Nube SA","phone":"541155500015","email":"envios@tiendanube.com","address":{"street":"Av. Santa Fe 1400","city":"Ciudad de Buenos Aires","province":"Buenos Aires","postal_code":"C1059"}},
  "recipient":{"dni":"31234001000","name":"María García","phone":"541199001104","address":{"street":"Av. Rivadavia 5800","city":"Ciudad de Buenos Aires","province":"Buenos Aires","postal_code":"C1424","latitude":-34.6115,"longitude":-58.4401}},
  "weight_kg":3,"package_type":"box","delivery_method":"retiro_sucursal","receiving_branch_id":"caba"
}'

create_and_capture '{
  "sender":{"dni":"20111000333","name":"Tienda Nube SA","phone":"541155500015","email":"envios@tiendanube.com","address":{"street":"Av. Santa Fe 1400","city":"Ciudad de Buenos Aires","province":"Buenos Aires","postal_code":"C1059"}},
  "recipient":{"dni":"31234001111","name":"Roberto Fernández","phone":"541199001105","address":{"street":"Av. Monroe 2800","city":"Ciudad de Buenos Aires","province":"Buenos Aires","postal_code":"C1428","latitude":-34.5692,"longitude":-58.4658}},
  "weight_kg":1,"package_type":"envelope","shipment_type":"express","delivery_method":"retiro_sucursal","receiving_branch_id":"caba"
}'

echo ""
echo "📋 Total creados: ${#IDS[@]}"

# ── CANCELACIONES ────────────────────────────────────────────
echo ""
echo "✖️  Cancelando algunos envíos..."
cancel() {
  local tid="$1" reason="$2" user="$3"
  local t
  t=$(login "$user" "${user}123")
  local resp
  resp=$(curl -s -X POST "$API/shipments/$tid/cancel" \
    -H "Authorization: Bearer $t" \
    -H "Content-Type: application/json" \
    -d "{\"reason\":\"$reason\"}")
  local tid_ok
  tid_ok=$(echo "$resp" | python3 -c "import sys,json;print(json.load(sys.stdin).get('tracking_id',''))" 2>/dev/null || echo "")
  if [ -n "$tid_ok" ]; then
    echo "  ✖ $tid cancelado ($reason)"
  else
    local err
    err=$(echo "$resp" | python3 -c "import sys,json;print(json.load(sys.stdin).get('error','desconocido'))" 2>/dev/null || echo "desconocido")
    echo "  ~ $tid no cancelable: $err"
  fi
}

# Cancelar algunos del seed (que están en at_origin_hub o at_hub)
cancel "LT-CB00001" "Cliente solicitó cancelación" "sup_caba"
cancel "LT-CB00004" "Destinatario no encontrado en la dirección" "sup_caba"
cancel "LT-MZ00002" "Cambio de método de envío del cliente" "sup_caba"
cancel "LT-CDB00010" "Producto dañado antes de despachar" "sup_caba"
cancel "LT-POS00003" "Reclamo del cliente por demora" "sup_caba"

# ── TRANSICIONES A OUT_FOR_DELIVERY ─────────────────────────
echo ""
echo "🚚 Transicionando a última milla..."
out_for_delivery() {
  local tid="$1"
  local resp
  resp=$(curl -s -X PATCH "$API/shipments/$tid/status" \
    -H "Authorization: Bearer $TOKEN_SUP" \
    -H "Content-Type: application/json" \
    -d '{"status":"out_for_delivery","driver_id":"5"}')
  local tid_ok
  tid_ok=$(echo "$resp" | python3 -c "import sys,json;print(json.load(sys.stdin).get('tracking_id',''))" 2>/dev/null || echo "")
  if [ -n "$tid_ok" ]; then
    echo "  🚚 $tid → última milla (chofer ID 5)"
    return 0
  else
    local err
    err=$(echo "$resp" | python3 -c "import sys,json;print(json.load(sys.stdin).get('error','desconocido'))" 2>/dev/null || echo "desconocido")
    echo "  ~ $tid: $err"
    return 1
  fi
}

# Poner algunos CABA at_hub en última milla
out_for_delivery "LT-LM00001"
out_for_delivery "LT-LM00002"
out_for_delivery "LT-LM00005"
out_for_delivery "LT-DELIVER01"

# ── INICIAR RUTA DEL CHOFER ────────────────────────────────
echo ""
echo "🚀 Iniciando ruta del chofer..."
curl -s -X POST "$API/driver/route/start" \
  -H "Authorization: Bearer $TOKEN_CHOFER" \
  -H "Content-Type: application/json" > /dev/null
echo "  ✅ Ruta iniciada"

# ── ENTREGAS ─────────────────────────────────────────────────
echo ""
echo "✅ Entregando..."
deliver() {
  local tid="$1" dni="$2"
  local resp
  resp=$(curl -s -X PATCH "$API/shipments/$tid/status" \
    -H "Authorization: Bearer $TOKEN_CHOFER" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"delivered\",\"recipient_dni\":\"$dni\"}")
  local tid_ok
  tid_ok=$(echo "$resp" | python3 -c "import sys,json;print(json.load(sys.stdin).get('tracking_id',''))" 2>/dev/null || echo "")
  if [ -n "$tid_ok" ]; then
    echo "  ✅ $tid entregado"
    return 0
  else
    local err
    err=$(echo "$resp" | python3 -c "import sys,json;print(json.load(sys.stdin).get('error','desconocido'))" 2>/dev/null || echo "desconocido")
    echo "  ~ $tid: $err"
    return 1
  fi
}

# Iniciar ruta del chofer (necesario antes de entregar)
echo "🚀 Iniciando ruta del chofer..."
curl -s -X POST "$API/driver/route/start" \
  -H "Authorization: Bearer $TOKEN_CHOFER" \
  -H "Content-Type: application/json" > /dev/null
echo "  ✅ Ruta iniciada"

# Entregar los que están en última milla (necesitan DNI del recipient del seed)
deliver "LT-LM00001" "31204567"
deliver "LT-LM00002" "32556677"

# ── ENTREGA FALLIDA + REINTENTO ──────────────────────────────
echo ""
echo "⚠️  Simulando entrega fallida y reintento..."
fail_delivery() {
  local tid="$1"
  curl -s -X PATCH "$API/shipments/$tid/status" \
    -H "Authorization: Bearer $TOKEN_CHOFER" \
    -H "Content-Type: application/json" \
    -d '{"status":"delivery_failed","notes":"Destinatario ausente - se intentará nuevamente mañana"}' \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print('  ⚠️ ',d.get('tracking_id',''),'→ delivery_failed' if 'tracking_id' in d else d.get('error',''))" 2>/dev/null || true
}

fail_delivery "LT-LM00005"

# Devolver fallido a sucursal
curl -s -X PATCH "$API/shipments/LT-LM00005/status" \
  -H "Authorization: Bearer $TOKEN_SUP" \
  -H "Content-Type: application/json" \
  -d '{"status":"at_hub","notes":"Envío devuelto a sucursal por entrega fallida"}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('  🔄 LT-LM00005 → at_hub (vuelta a sucursal)')" 2>/dev/null || true

# ── INCIDENTES (comentario con flag) ─────────────────────────
echo ""
echo "📝 Reportando incidentes..."
report_incident() {
  local tid="$1" notes="$2"
  curl -s -X POST "$API/shipments/$tid/comments" \
    -H "Authorization: Bearer $TOKEN_SUP" \
    -H "Content-Type: application/json" \
    -d "{\"text\":\"$notes\",\"is_incident\":true}" > /dev/null
  echo "  🚨 Incidente reportado en $tid"
}
report_incident "LT-CDB00001" "Paquete recibido con abolladuras en el embalaje"
report_incident "LT-MZH00001" "El remitente reportó que el contenido está incompleto"

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Dashboard listo para ver datos"
echo "  🌐 http://localhost:5173/dashboard"
echo "═══════════════════════════════════════════"
