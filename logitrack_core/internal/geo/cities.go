package geo

import (
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// argentineCities maps normalized city names to {lat, lng}.
// Covers all provincial capitals + major urban centers.
var argentineCities = map[string][2]float64{
	// Buenos Aires Province
	"la plata":            {-34.9215, -57.9545},
	"mar del plata":       {-38.0023, -57.5575},
	"bah'ia blanca":       {-38.7183, -62.2663},
	"bahia blanca":        {-38.7183, -62.2663},
	"quilmes":             {-34.7224, -58.2544},
	"lanus":               {-34.7010, -58.3921},
	"lomas de zamora":     {-34.7576, -58.4054},
	"almirante brown":     {-34.8154, -58.3870},
	"merlo":               {-34.6667, -58.7333},
	"moreno":              {-34.6500, -58.7833},
	"san miguel":          {-34.5418, -58.7074},
	"tigre":               {-34.4260, -58.5797},
	"san isidro":          {-34.4692, -58.5117},
	"vicente lopez":       {-34.5256, -58.4766},
	"tres de febrero":     {-34.6062, -58.5614},
	"general san martin":  {-34.5695, -58.5328},
	"hurlingham":          {-34.5893, -58.6383},
	"ituzaingo":           {-34.6576, -58.6744},
	"moron":               {-34.6530, -58.6198},
	"la matanza":          {-34.7714, -58.5996},
	"esteban echeverria":  {-34.8168, -58.4602},
	"florencio varela":    {-34.8167, -58.2833},
	"berazategui":         {-34.7667, -58.2167},
	"avellaneda":          {-34.6618, -58.3672},
	"san nicolas":         {-33.3355, -60.2266},
	"tandil":              {-37.3213, -59.1330},
	"pergamino":           {-33.8887, -60.5698},
	"junin":               {-34.5927, -60.9456},
	"olavarria":           {-36.8924, -60.3226},
	"necochea":            {-38.5551, -58.7378},
	"san pedro":           {-33.6785, -59.6667},
	"lujan":               {-34.5695, -59.1052},
	"campana":             {-34.1632, -58.9540},
	"zarate":              {-34.0960, -59.0271},
	"pilar":               {-34.4590, -58.9134},
	"general pueyrredon":  {-38.0023, -57.5575},
	"azul":                {-36.7779, -59.8586},
	"chivilcoy":           {-34.8975, -60.0189},

	// Ciudad de Buenos Aires
	"ciudad de buenos aires": {-34.6037, -58.3816},
	"buenos aires":           {-34.6037, -58.3816},
	"caba":                   {-34.6037, -58.3816},

	// Córdoba
	"cordoba":               {-31.4201, -64.1888},
	"rio cuarto":            {-33.1307, -64.3499},
	"san francisco":         {-31.4276, -62.0853},
	"villa maria":           {-32.4087, -63.2437},
	"rio tercero":           {-32.1726, -64.1085},
	"cosquin":               {-31.2415, -64.4728},
	"alta gracia":           {-31.6548, -64.4312},
	"villa carlos paz":      {-31.4248, -64.4983},
	"jesus maria":           {-30.9826, -64.0892},
	"marcos juarez":         {-32.6985, -62.1038},

	// Mendoza
	"mendoza":            {-32.8908, -68.8272},
	"san rafael":         {-34.6177, -68.3303},
	"godoy cruz":         {-32.9247, -68.8376},
	"guaymallen":         {-32.8931, -68.7836},
	"lujan de cuyo":      {-33.0477, -68.8804},
	"maipu":              {-32.9813, -68.7775},
	"las heras":          {-32.8408, -68.8171},
	"rivadavia":          {-33.1833, -68.4667},

	// Santa Fe
	"santa fe":            {-31.6333, -60.7000},
	"rosario":             {-32.9468, -60.6393},
	"venado tuerto":       {-33.7454, -61.9683},
	"rafaela":             {-31.2503, -61.4870},
	"reconquista":         {-29.1446, -59.6467},
	"casilda":             {-33.0440, -61.1685},
	"santo tome":          {-31.6643, -60.7646},
	"esperanza":           {-31.4479, -60.9312},

	// Tucumán
	"san miguel de tucuman": {-26.8241, -65.2226},
	"tucuman":               {-26.8241, -65.2226},
	"yerba buena":           {-26.8154, -65.2908},
	"tafi viejo":            {-26.7266, -65.2571},
	"concepcion":            {-27.3356, -65.5830},
	"banda del rio sali":    {-26.8351, -65.1626},

	// Entre Ríos
	"parana":        {-31.7333, -60.5333},
	"concordia":     {-31.3929, -58.0199},
	"gualeguaychu":  {-33.0133, -58.5233},
	"gualeguay":     {-33.1429, -59.3155},
	"colon":         {-32.2229, -58.1438},

	// Salta
	"salta":         {-24.7859, -65.4117},
	"oran":          {-23.1333, -64.3167},
	"tartagal":      {-22.5167, -63.8000},
	"san ramon de la nueva oran": {-23.1333, -64.3167},
	"cafayate":      {-26.0692, -65.9731},
	"rosario de lerma": {-24.9833, -65.5833},

	// Misiones
	"posadas":       {-27.3671, -55.8965},
	"oberá":         {-27.4833, -55.1167},
	"obera":         {-27.4833, -55.1167},
	"eldorado":      {-26.4003, -54.6267},
	"apostoles":     {-27.9167, -55.7667},
	"puerto iguazu": {-25.5997, -54.5697},

	// Chaco
	"resistencia":   {-27.4606, -58.9867},
	"presidencia roque saenz pena": {-26.7833, -60.4333},
	"villa angela":  {-27.5667, -60.7167},
	"charata":       {-27.2167, -61.1833},

	// Corrientes
	"corrientes":    {-27.4806, -58.8341},
	"goya":          {-29.1434, -59.2641},
	"mercedes":      {-29.1804, -58.0817},
	"curuzú cuatiá": {-29.7833, -58.0500},
	"curuzu cuatia": {-29.7833, -58.0500},
	"paso de los libres": {-29.7167, -57.0833},

	// Jujuy
	"san salvador de jujuy": {-24.1858, -65.2995},
	"jujuy":                 {-24.1858, -65.2995},
	"palpalá":               {-24.2504, -65.2087},
	"palpala":               {-24.2504, -65.2087},
	"libertador general san martin": {-23.8038, -64.7878},
	"humahuaca":             {-23.2027, -65.3498},

	// Santiago del Estero
	"santiago del estero": {-27.7951, -64.2615},
	"la banda":            {-27.7351, -64.2396},
	"termas de rio hondo": {-27.4944, -64.8626},
	"frías":               {-28.6500, -65.1333},
	"frias":               {-28.6500, -65.1333},

	// San Luis
	"san luis":      {-33.2950, -66.3356},
	"villa mercedes": {-33.6667, -65.4667},
	"merlo san luis": {-32.3437, -65.0134},
	"san francisco del monte de oro": {-32.5925, -66.1292},

	// La Rioja
	"la rioja":      {-29.4130, -66.8559},
	"chilecito":     {-29.1601, -67.4994},
	"chamical":      {-30.3583, -66.3119},

	// Catamarca
	"san fernando del valle de catamarca": {-28.4696, -65.7795},
	"catamarca":     {-28.4696, -65.7795},
	"belen":         {-27.6472, -67.0289},
	"andalgala":     {-27.5985, -66.3175},

	// Neuquén
	"neuquen":       {-38.9516, -68.0591},
	"san martin de los andes": {-40.1575, -71.3533},
	"zapala":        {-38.8993, -70.0636},
	"centenario":    {-38.8250, -68.1280},
	"plottier":      {-38.9667, -68.2333},

	// Río Negro
	"viedma":        {-40.8135, -62.9967},
	"general roca":  {-39.0333, -67.5833},
	"cipolletti":    {-38.9333, -67.9833},
	"bariloche":     {-41.1335, -71.3103},
	"san carlos de bariloche": {-41.1335, -71.3103},
	"allen":         {-38.9833, -67.8333},
	"rio colorado":  {-38.9950, -64.0929},

	// Chubut
	"rawson":        {-43.3002, -65.1023},
	"comodoro rivadavia": {-45.8647, -67.4974},
	"trelew":        {-43.2486, -65.3094},
	"esquel":        {-42.9072, -71.3156},
	"puerto madryn": {-42.7692, -65.0385},

	// Santa Cruz
	"rio gallegos":  {-51.6230, -69.2168},
	"caleta olivia": {-46.4372, -67.5209},
	"perito moreno": {-46.5940, -70.9304},
	"puerto santa cruz": {-50.0167, -68.5167},

	// Tierra del Fuego
	"ushuaia":       {-54.8019, -68.3030},
	"rio grande":    {-53.7903, -67.7074},
	"tolhuin":       {-54.5011, -67.1967},

	// San Juan
	"san juan":           {-31.5375, -68.5364},
	"rivadavia san juan": {-31.5320, -68.5744},
	"caucete":            {-31.6521, -68.2744},
	"rawson san juan":    {-31.5296, -68.5395},

	// La Pampa
	"santa rosa":    {-36.6167, -64.2833},
	"general pico":  {-35.6560, -63.7560},
	"toay":          {-36.6667, -64.3833},

	// Formosa
	"formosa":       {-26.1775, -58.1781},
	"clorinda":      {-25.2833, -57.7167},
	"pirané":        {-25.7313, -59.1089},
	"pirane":        {-25.7313, -59.1089},
}

var normalizer = transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)

// normalizeCity removes accents and lowercases a city name for lookup.
func normalizeCity(city string) string {
	result, _, _ := transform.String(normalizer, strings.ToLower(strings.TrimSpace(city)))
	return result
}

// LookupCity returns coordinates for a known Argentine city.
// Returns (lat, lng, true) if found, or (0, 0, false) if not.
func LookupCity(city string) (float64, float64, bool) {
	coords, ok := argentineCities[normalizeCity(city)]
	if !ok {
		return 0, 0, false
	}
	return coords[0], coords[1], true
}
