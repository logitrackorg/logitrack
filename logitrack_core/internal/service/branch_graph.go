package service

import (
	"log"
	"time"

	"github.com/logitrack/core/internal/ml"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// BranchGraphService gestiona el grafo de sucursales y expone el shortest-path.
//
// El grafo tiene aristas dirigidas. Cada arista representa un tramo de tránsito
// observado históricamente y/o definido manualmente por un admin.
//
// ShortestPath usa Dijkstra sobre DistanceKm. En el futuro puede configurarse
// para usar AvgTransitHours como peso (para optimizar tiempo en lugar de distancia).
type BranchGraphService struct {
	repo      repository.BranchGraphRepository
	branchRepo repository.BranchRepository
}

func NewBranchGraphService(repo repository.BranchGraphRepository, branchRepo repository.BranchRepository) *BranchGraphService {
	return &BranchGraphService{repo: repo, branchRepo: branchRepo}
}

// GetGraph devuelve el grafo completo (todas las aristas).
func (s *BranchGraphService) GetGraph() (model.BranchGraph, error) {
	edges, err := s.repo.ListEdges()
	if err != nil {
		return model.BranchGraph{}, err
	}
	return model.BranchGraph{Edges: edges}, nil
}

// SetEnabled activa o desactiva una arista.
func (s *BranchGraphService) SetEnabled(from, to string, enabled bool) error {
	return s.repo.SetEnabled(from, to, enabled)
}

// RunAutoderive reconstruye las aristas del grafo desde shipment_hop_metrics.
// Aristas manuales (source="manual") conservan su estado enabled.
// Devuelve el número de aristas procesadas.
func (s *BranchGraphService) RunAutoderive() (int, error) {
	aggregates, err := s.repo.DeriveHopAggregates()
	if err != nil {
		return 0, err
	}
	if len(aggregates) == 0 {
		log.Printf("[branch_graph] sin hops históricos para derivar aristas")
		return 0, nil
	}

	count := 0
	skipped := 0
	for _, agg := range aggregates {
		distKm, ok := s.computeDistance(agg.FromBranchID, agg.ToBranchID)
		if !ok {
			// Distancia indeterminada (branch faltante o distancia 0 degenerada).
			// Saltamos: una arista con distancia 0 sería preferida por Dijkstra
			// sobre cualquier otra y ensuciaría el grafo silenciosamente.
			log.Printf("[branch_graph] saltando arista %s→%s: distancia indeterminada (branch faltante o coords inválidas)", agg.FromBranchID, agg.ToBranchID)
			skipped++
			continue
		}
		edge := model.BranchEdge{
			FromBranchID:    agg.FromBranchID,
			ToBranchID:      agg.ToBranchID,
			DistanceKm:      distKm,
			AvgTransitHours: agg.AvgTransitHours,
			ObservedCount:   agg.ObservedCount,
			Enabled:         true,
			Source:          "auto",
			UpdatedAt:       time.Now().UTC(),
		}
		if err := s.repo.UpsertEdge(edge); err != nil {
			log.Printf("[branch_graph] error upserting edge %s→%s: %v", agg.FromBranchID, agg.ToBranchID, err)
			continue
		}
		count++
	}
	if skipped > 0 {
		log.Printf("[branch_graph] auto-derive: %d aristas válidas, %d saltadas por distancia inválida", count, skipped)
	}
	return count, nil
}

// ShortestPath calcula el camino más corto (por distancia) entre dos sucursales
// usando Dijkstra sobre las aristas habilitadas.
//
// Devuelve la lista ordenada de branch IDs incluyendo origen y destino.
// Devuelve nil si no hay camino o si from == to retorna []string{from}.
func (s *BranchGraphService) ShortestPath(from, to string) []string {
	if from == to {
		return []string{from}
	}

	edges, err := s.repo.ListEdges()
	if err != nil {
		return nil
	}

	// Grafo de adyacencia (solo aristas habilitadas)
	type neighbor struct {
		to   string
		dist float64
	}
	adj := map[string][]neighbor{}
	for _, e := range edges {
		if !e.Enabled {
			continue
		}
		adj[e.FromBranchID] = append(adj[e.FromBranchID], neighbor{e.ToBranchID, e.DistanceKm})
	}

	// Dijkstra — grafo pequeño (≤ 20 sucursales): cola lineal alcanza.
	type node struct {
		id   string
		dist float64
	}

	dist := map[string]float64{from: 0}
	prev := map[string]string{}
	visited := map[string]bool{}
	queue := []node{{from, 0}}

	for len(queue) > 0 {
		// Extraer nodo con menor distancia
		minIdx := 0
		for i := 1; i < len(queue); i++ {
			if queue[i].dist < queue[minIdx].dist {
				minIdx = i
			}
		}
		curr := queue[minIdx]
		queue = append(queue[:minIdx], queue[minIdx+1:]...)

		if visited[curr.id] {
			continue
		}
		visited[curr.id] = true

		if curr.id == to {
			break
		}

		for _, nb := range adj[curr.id] {
			newDist := curr.dist + nb.dist
			d, known := dist[nb.to]
			if !known || newDist < d {
				dist[nb.to] = newDist
				prev[nb.to] = curr.id
				queue = append(queue, node{nb.to, newDist})
			}
		}
	}

	if _, reachable := dist[to]; !reachable {
		return nil
	}

	// Reconstruir camino
	var path []string
	for curr := to; curr != ""; curr = prev[curr] {
		path = append([]string{curr}, path...)
		if curr == from {
			break
		}
	}
	if len(path) == 0 || path[0] != from {
		return nil
	}
	return path
}

// ComputeRemainingTransitHours suma los avg_transit_hours de los edges restantes
// del path a partir de fromIndex. Devuelve (horas, true) si todos los edges tienen
// datos. Devuelve (0, false) si falta algún edge o no tiene avg_transit_hours.
func (s *BranchGraphService) ComputeRemainingTransitHours(path []string, fromIndex int) (float64, bool) {
	if fromIndex >= len(path)-1 {
		return 0, true // ya en destino
	}
	edges, err := s.repo.ListEdges()
	if err != nil {
		return 0, false
	}
	edgeMap := map[string]float64{}
	for _, e := range edges {
		if e.Enabled && e.AvgTransitHours > 0 {
			edgeMap[e.FromBranchID+"|"+e.ToBranchID] = e.AvgTransitHours
		}
	}
	total := 0.0
	for i := fromIndex; i < len(path)-1; i++ {
		h, ok := edgeMap[path[i]+"|"+path[i+1]]
		if !ok {
			return 0, false
		}
		total += h
	}
	return total, true
}

// CreateEdge crea una arista manual. Si ya existe, la sobreescribe con source="manual".
// Si no se provee distancia, la calcula con Haversine / fallback provincial.
func (s *BranchGraphService) CreateEdge(edge model.BranchEdge) error {
	if edge.DistanceKm <= 0 {
		if d, ok := s.computeDistance(edge.FromBranchID, edge.ToBranchID); ok {
			edge.DistanceKm = d
		}
	}
	edge.Source = "manual"
	edge.Enabled = true
	edge.UpdatedAt = time.Now().UTC()
	return s.repo.UpsertEdge(edge)
}

// computeDistance calcula la distancia entre dos sucursales usando Haversine
// si tienen coordenadas, o la distancia interprovincial como fallback.
// Devuelve (km, true) cuando el cálculo es confiable, (0, false) cuando:
//   - alguna de las branches no existe
//   - la distancia computada es 0 (coords iguales o provincia desconocida que
//     cae al fallback de CABA en ambas branches)
// El caller debe descartar las aristas con ok=false: distancia 0 sería preferida
// por Dijkstra sobre cualquier otra ruta y rompería el grafo silenciosamente.
func (s *BranchGraphService) computeDistance(fromID, toID string) (float64, bool) {
	from, ok1 := s.branchRepo.GetByID(fromID)
	to, ok2 := s.branchRepo.GetByID(toID)
	if !ok1 || !ok2 {
		return 0, false
	}
	var dist float64
	if from.Latitude != nil && from.Longitude != nil && to.Latitude != nil && to.Longitude != nil {
		dist = ml.HaversineKm(*from.Latitude, *from.Longitude, *to.Latitude, *to.Longitude)
	} else {
		dist = ml.ComputeDistance(from.Province, to.Province)
	}
	if dist <= 0 {
		return 0, false
	}
	return dist, true
}
