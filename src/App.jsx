import React, { useState, useEffect, useRef, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline, Circle } from "react-leaflet";
import axios from "axios";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// --- LEAFLET CONFIG & ICONS ---
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
});

const userIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const poiIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-violet.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// --- HELPER FUNCTIONS ---

function RecenterMap({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.flyTo(center, zoom || 14, { duration: 1.5 });
  }, [center, zoom, map]);
  return null;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

// NOTE: Distance calculation is removed from the main processing loop 
//       because we now rely on Overpass's internal sorting (qt).

export default function App() {
  const [query, setQuery] = useState("");
  const [nominatimResults, setNominatimResults] = useState([]); 
  const [places, setPlaces] = useState([]);
  const [searchAreaPoint, setSearchAreaPoint] = useState(null); 
  const [selectedPlaceId, setSelectedPlaceId] = useState(null);
  const markerRefs = useRef({});
  const [center, setCenter] = useState([10.7721, 106.6983]); 
  const [zoom, setZoom] = useState(13);
  const [myLocation, setMyLocation] = useState(null);
  const [routePath, setRoutePath] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  // --- API CALLS ---

  // Refactored Nominatim Search
  const searchNominatim = useCallback(async (searchQuery) => {
    if (searchQuery.length < 3) return;

    setLoading(true);
    setNominatimResults([]);
    setPlaces([]);
    setSearchAreaPoint(null);
    setStatusMsg(`Đang tìm kiếm vị trí cho '${searchQuery}'...`);

    try {
      const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${searchQuery}&addressdetails=1&limit=10`; 
      const geoRes = await axios.get(geoUrl);
      
      if (geoRes.data.length > 0) {
        setNominatimResults(geoRes.data);
        setStatusMsg(`Chọn 1 kết quả để tìm các điểm thú vị xung quanh.`);
        
      } else {
        setNominatimResults([]);
        setStatusMsg("Không tìm thấy kết quả nào.");
      }
    } catch (err) {
      console.error(err);
      setStatusMsg("Lỗi kết nối Nominatim.");
    }
    setLoading(false);
  }, []); // useCallback ensures this function is stable

  // 1. AUTOCOMPLETE/DEBOUNCE LOGIC
  useEffect(() => {
    if (query.length < 3) {
        setNominatimResults([]);
        return;
    }
    
    // Set a timeout to delay the search
    const delayDebounceFn = setTimeout(() => {
        searchNominatim(query); 
    }, 500); // 500ms delay

    // Cleanup function: clears timeout if query changes before 500ms passes
    return () => clearTimeout(delayDebounceFn);
  }, [query, searchNominatim]); 

  // 2. POI Search (Faster QT Sort)
  const fetchInterestingPlaces = async (lat, lon) => {
    const radius = 2000;

    const overpassQuery = `
      [out:json][timeout:7];
      (
        node["tourism"~"attraction|museum|gallery|viewpoint|artwork"](around:${radius},${lat},${lon});
        node["historic"](around:${radius},${lat},${lon});
        node["amenity"="theatre"](around:${radius},${lat},${lon});
        node["amenity"="arts_centre"](around:${radius},${lat},${lon});
        node["leisure"~"park|garden"](around:${radius},${lat},${lon});
      );
      out body 15 qt;
    `;

    try {
      const url = "https://overpass-api.de/api/interpreter";
      const res = await axios.post(url, overpassQuery, {
        headers: { "Content-Type": "text/plain" }
      });

      const elements = res.data.elements
        .filter(e => e.tags && e.tags.name)
        .map(e => ({
          id: e.id,
          lat: e.lat,
          lon: e.lon,
          name: e.tags.name,
          score: 
            (e.tags.wikidata ? 2 : 0) +
            (e.tags.wikipedia ? 2 : 0) +
            (e.tags.tourism ? 1 : 0) +
            (e.tags.historic ? 1 : 0),
          type:
            e.tags.tourism === "museum" ? "Bảo tàng" :
            e.tags.tourism === "attraction" ? "Điểm tham quan" :
            e.tags.tourism === "viewpoint" ? "Điểm ngắm cảnh" :
            e.tags.historic ? "Di tích" :
            e.tags.leisure === "park" ? "Công viên" :
            "Địa điểm"
        }));

      // Sort more interesting places first
      elements.sort((a, b) => b.score - a.score);
      const top5 = elements.slice(0, 5);

      setPlaces(top5);
      setStatusMsg(`Đã tìm thấy ${elements.length} địa điểm nổi bật.`);
    } catch (err) {
      setStatusMsg("Lỗi tải dữ liệu POI.");
    }
  };



  // 3. SELECTION HANDLER
  const handleResultSelect = async (lat, lon) => {
    setNominatimResults([]); 
    setLoading(true);
    setRoutePath([]);
    setRouteInfo(null);
    setCenter([lat, lon]);
    setZoom(15);
    setSearchAreaPoint([lat, lon]); 
    
    setStatusMsg(`Đang tìm 5 điểm thú vị quanh khu vực...`);
    
    await fetchInterestingPlaces(lat, lon);
    setLoading(false);
  };
  
  // 4. ROUTING HANDLERS (Unchanged)
  const handleDirectionClick = (destLat, destLon) => {
    if (myLocation) {
      fetchRoute(myLocation[0], myLocation[1], destLat, destLon);
    } else {
      if (!navigator.geolocation) {
        alert("Trình duyệt không hỗ trợ GPS");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setMyLocation([latitude, longitude]);
          fetchRoute(latitude, longitude, destLat, destLon);
        },
        (err) => alert("Cần quyền truy cập vị trí để chỉ đường.")
      );
    }
  };

  const fetchRoute = async (startLat, startLon, endLat, endLon) => {
    setStatusMsg("Đang vẽ đường...");
    const start = `${startLon},${startLat}`;
    const end = `${endLon},${endLat}`;
    const url = `https://router.project-osrm.org/route/v1/driving/${start};${end}?overview=full&geometries=geojson`;

    try {
      const res = await axios.get(url);
      const route = res.data.routes[0];
      const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
      
      setRoutePath(coords);
      setRouteInfo({
        dist: (route.distance / 1000).toFixed(1)
      });

      setStatusMsg("");
    } catch (err) {
      setStatusMsg("Không tìm thấy đường đi.");
    }
  };

  // --- STYLES ---
  const sidebarStyle = {
    width: "350px",
    height: "100vh",
    background: "#ffffff",
    boxShadow: "2px 0 10px rgba(0,0,0,0.1)",
    zIndex: 1000,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden"
  };

  const scrollAreaStyle = {
    flex: 1,
    overflowY: "auto",
    padding: "15px",
    background: "#f8f9fa"
  };

  const cardStyle = (isSelected) => ({
    background: isSelected ? "#e6e6ff" : "white",
    border: isSelected ? "1px solid #6610f2" : "1px solid #eee",
    borderRadius: "8px",
    padding: "12px",
    marginBottom: "10px",
    cursor: "pointer",
    transition: "all 0.2s",
    boxShadow: "0 2px 4px rgba(0,0,0,0.05)"
  });

  // --- COMPONENT RENDER ---

  const renderContentList = () => {
    // A. Show list of initial search results (Step 1: Autocomplete)
    if (nominatimResults.length > 0) {
      return nominatimResults.map((result) => (
        <div 
          key={result.place_id} 
          style={cardStyle(false)}
          onClick={() => handleResultSelect(parseFloat(result.lat), parseFloat(result.lon))}
        >
          <div style={{ fontWeight: "bold", fontSize: "15px", color: "#333" }}>{result.display_name.split(',')[0]}</div>
          <div style={{ fontSize: "12px", color: "#666", marginTop: "5px" }}>{result.display_name}</div>
          <div style={{ fontSize: "12px", color: "#007bff", marginTop: "5px" }}>(Click để tìm POI xung quanh)</div>
        </div>
      ));
    }

    // B. Show list of found POIs (Step 2)
    return places.map((place) => (
      <div 
        key={place.id} 
        style={cardStyle(selectedPlaceId === place.id)}
        onClick={() => {
          setSelectedPlaceId(place.id);
          setCenter([place.lat, place.lon]);
          setZoom(16);
          const marker = markerRefs.current[place.id];
          if (marker) marker.openPopup();
        }}
      >
        <div style={{ fontWeight: "bold", fontSize: "15px", color: "#333" }}>{place.name}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "5px" }}>
          <span style={{ fontSize: "12px", color: "#666", background: "#eee", padding: "2px 6px", borderRadius: "4px" }}>
            {place.type}
          </span>
          {/* Note: Removed distance display as calculation is complex and removed for speed */}
        </div>
        
        {selectedPlaceId === place.id && (
          <button 
            style={{ width: "100%", marginTop: "10px", padding: "8px", background: "#28a745", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation(); 
              handleDirectionClick(place.lat, place.lon);
            }}
          >
            📍 Chỉ đường từ vị trí của bạn
          </button>
        )}
      </div>
    ));
  };


  return (
    <div style={{ display: "flex", flexDirection: "row", height: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif" }}>
      
      {/* --- LEFT SIDEBAR --- */}
      <div style={sidebarStyle}>
        
        {/* Header & Search */}
        <div style={{ padding: "20px", borderBottom: "1px solid #eee" }}>
          <h2 style={{ margin: "0 0 15px 0", color: "#333", fontSize: "20px" }}>🗺️ Công cụ tìm kiếm POI</h2>
          
          <form onSubmit={e => e.preventDefault()} style={{ display: "flex", gap: "5px" }}>
            <input
              type="text"
              placeholder="Nhập khu vực (VD: Hồ Gươm)..."
              value={query}
              // onChange triggers the debounce/autocomplete search
              onChange={(e) => setQuery(e.target.value)} 
              style={{ flex: 1, padding: "10px", borderRadius: "6px", border: "1px solid #ddd", outline: "none" }}
            />
             {/* The "Tìm" button is optional now, search happens on type */}
            <button type="button" onClick={() => searchNominatim(query)} disabled={loading} style={{ padding: "0 15px", background: "#6610f2", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}>
              {loading ? "..." : "Tìm"}
            </button>
          </form>

          {/* Quick Buttons */}
          <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
             <button onClick={() => setQuery("Hà Nội")} style={{ flex:1, padding:"6px", fontSize:"12px", background:"#e9ecef", border:"none", borderRadius:"4px", cursor:"pointer" }}>Hà Nội</button>
             <button onClick={() => setQuery("Huế")} style={{ flex:1, padding:"6px", fontSize:"12px", background:"#e9ecef", border:"none", borderRadius:"4px", cursor:"pointer" }}>Huế</button>
             <button onClick={() => setQuery("Sài Gòn")} style={{ flex:1, padding:"6px", fontSize:"12px", background:"#e9ecef", border:"none", borderRadius:"4px", cursor:"pointer" }}>Sài Gòn</button>
          </div>
        </div>

        {/* Status & Route Info */}
        {(statusMsg || routeInfo) && (
          <div style={{ padding: "10px 20px", background: "#fff3cd", fontSize: "14px", borderBottom: "1px solid #eee" }}>
            {statusMsg && <div style={{color: "#856404"}}>{statusMsg}</div>}
            {routeInfo && (
              <div style={{ marginTop: "5px", color: "#155724", fontWeight: "bold" }}>
                🚗 {routeInfo.dist} km
              </div>
            )}
          </div>
        )}

        {/* Results List Area */}
        <div style={scrollAreaStyle}>
          {(nominatimResults.length === 0 && places.length === 0 && !loading) && (
            <div style={{ textAlign: "center", color: "#888", marginTop: "30px" }}>
              Bắt đầu gõ để tìm kiếm khu vực...
            </div>
          )}
          
          {renderContentList()}
        </div>
      </div>

      {/* --- MAP AREA --- */}
      <div style={{ flex: 1, position: "relative" }}>
        <MapContainer center={center} zoom={zoom} style={{ height: "100%", width: "100%" }} zoomControl={false}>
          <TileLayer
            attribution='&copy; OSM contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <RecenterMap center={center} zoom={zoom} />

          {/* Visualization of Search Area (2km radius) */}
          {searchAreaPoint && (
             <Circle 
                center={searchAreaPoint} 
                radius={2000} // 2000 meters = 2 km (Must match Overpass query)
                pathOptions={{ color: '#dc3545', fillColor: '#dc3545', fillOpacity: 0.2, weight: 2 }}
             />
          )}

          {/* My Location Marker */}
          {myLocation && (
            <Marker position={myLocation} icon={userIcon}>
               <Popup>Vị trí của bạn</Popup>
            </Marker>
          )}

          {/* POI Markers */}
          {places.map((place) => (
            <Marker 
              key={place.id} 
              position={[place.lat, place.lon]} 
              icon={poiIcon}
              ref={(el) => (markerRefs.current[place.id] = el)} 
              eventHandlers={{
                click: () => {
                  setSelectedPlaceId(place.id);
                }
              }}
            >
              <Popup>
                <b style={{fontSize:"14px"}}>{place.name}</b> <br/>
                <span style={{color:"#6610f2", fontWeight: "bold"}}>{place.type}</span> <br/>
                <button 
                  style={{ marginTop: "5px", padding: "5px 10px", background: "#28a745", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}
                  onClick={() => handleDirectionClick(place.lat, place.lon)}
                >
                  Chỉ đường
                </button>
              </Popup>
            </Marker>
          ))}

          {/* Route Polyline */}
          {routePath.length > 0 && (
            <Polyline positions={routePath} color="#007bff" weight={5} opacity={0.8} />
          )}
        </MapContainer>
      </div>

    </div>
  );
}