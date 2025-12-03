import React, { useState, useEffect, useRef, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline, Circle } from "react-leaflet";
import axios from "axios";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import "./App.css"; // Import file CSS

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

// Bảng dịch mã thời tiết WMO sang tiếng Việt
const weatherCodeMap = {
  0: "☀️ Trời quang (Nắng)",
  1: "🌤️ Ít mây",
  2: "⛅ Mây rải rác",
  3: "☁️ Nhiều mây",
  45: "🌫️ Sương mù",
  48: "🌫️ Sương mù đọng",
  51: "🌧️ Mưa phùn nhẹ",
  53: "🌧️ Mưa phùn",
  55: "🌧️ Mưa phùn dày",
  61: "☔ Mưa nhỏ",
  63: "☔ Mưa vừa",
  65: "☔ Mưa to",
  80: "🌦️ Mưa rào nhẹ",
  81: "🌦️ Mưa rào",
  82: "⛈️ Mưa rào mạnh",
  95: "⚡ Dông",
  96: "⚡ Dông kèm mưa đá",
  99: "⚡ Dông kèm mưa đá lớn"
};

// --- HELPER COMPONENTS ---

function RecenterMap({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.flyTo(center, zoom || 14, { duration: 1.5 });
  }, [center, zoom, map]);
  return null;
}

export default function App() {
  // State
  const [query, setQuery] = useState("");
  const [nominatimResults, setNominatimResults] = useState([]);
  const [places, setPlaces] = useState([]);
  const [searchAreaPoint, setSearchAreaPoint] = useState(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState(null);
  const [center, setCenter] = useState([10.7721, 106.6983]);
  const [zoom, setZoom] = useState(13);
  const [myLocation, setMyLocation] = useState(null);
  const [routePath, setRoutePath] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [weatherData, setWeatherData] = useState(null);
  const [transInput, setTransInput] = useState("");
  const [transResult, setTransResult] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);

  const markerRefs = useRef({});

  // --- API LOGIC ---

  const searchNominatim = useCallback(async (searchQuery) => {
    if (searchQuery.length < 3) return;
    setLoading(true);
    setNominatimResults([]);
    setPlaces([]);
    setSearchAreaPoint(null);
    setWeatherData(null);

    setRoutePath([]);      // Xóa đường kẻ xanh trên bản đồ
    setRouteInfo(null);

    setStatusMsg(`Đang tìm kiếm '${searchQuery}'...`);

    try {
      const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${searchQuery}&addressdetails=1&limit=10`;
      const res = await axios.get(geoUrl);
      if (res.data.length > 0) {
        setNominatimResults(res.data);
        setStatusMsg("Chọn một địa điểm từ danh sách.");
        // setCenter([parseFloat(res.data[0].lat), parseFloat(res.data[0].lon)]);
        // setZoom(12);
      } else {
        setStatusMsg("Không tìm thấy kết quả.");
      }
    } catch (err) {
      console.error(err);
      setStatusMsg("Lỗi kết nối.");
    }
    setLoading(false);
  }, []);

  // Debounce search
  useEffect(() => {
    if (query.length < 3) {
      setNominatimResults([]);
      return;
    }
    const timeout = setTimeout(() => searchNominatim(query), 500);
    return () => clearTimeout(timeout);
  }, [query, searchNominatim]);

  const fetchWeatherData = async (lat, lon, displayName) => {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=celsius&timezone=auto`;
      const res = await axios.get(url);
      const data = res.data.current_weather;
      
      // Lấy mô tả từ bảng mã, nếu không có thì ghi "Không xác định"
      const description = weatherCodeMap[data.weathercode] || "Không xác định";

      setWeatherData({
        name: displayName.split(',')[0],
        temp: data.temperature.toFixed(1),
        desc: description, // Ví dụ: "☀️ Trời quang (Nắng)"
        wind: data.windspeed // Lưu thêm gió để hiển thị phụ
      });
    } catch (err) {
      console.error(err);
      setWeatherData({ error: "Lỗi tải thời tiết" });
    }
  };

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

  const handleResultSelect = async (lat, lon, displayName) => {
    setNominatimResults([]);
    setLoading(true);
    setRoutePath([]);
    setRouteInfo(null);
    setCenter([lat, lon]);
    setZoom(15);
    setSearchAreaPoint([lat, lon]);
    
    fetchWeatherData(lat, lon, displayName);
    await fetchInterestingPlaces(lat, lon);
    setLoading(false);
  };

  const handleDirectionClick = (destLat, destLon) => {
    if (myLocation) {
      fetchRoute(myLocation[0], myLocation[1], destLat, destLon);
    } else {
      if (!navigator.geolocation) return alert("Trình duyệt không hỗ trợ GPS");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setMyLocation([latitude, longitude]);
          fetchRoute(latitude, longitude, destLat, destLon);
        },
        () => alert("Cần quyền vị trí.")
      );
    }
  };

  const fetchRoute = async (startLat, startLon, endLat, endLon) => {
    setStatusMsg("Đang vẽ đường...");
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson`;
      const res = await axios.get(url);
      const route = res.data.routes[0];
      setRoutePath(route.geometry.coordinates.map(c => [c[1], c[0]]));
      setRouteInfo({
        dist: (route.distance / 1000).toFixed(1),
        time: (route.duration / 60).toFixed(0)
      });
      setStatusMsg("");
    } catch (err) {
      setStatusMsg("Không tìm thấy đường đi.");
    }
  };

  const handleTranslate = async () => {
    if (!transInput.trim()) return;
    setIsTranslating(true);
    setTransResult("");

    try {
      // Gọi API dịch Anh -> Việt (Thay thế cho googletrans trong Python)
      const res = await axios.get(`https://api.mymemory.translated.net/get?q=${transInput}&langpair=en|vi`);
      
      if (res.data && res.data.responseData) {
        setTransResult(res.data.responseData.translatedText);
      } else {
        setTransResult("Lỗi dịch.");
      }
    } catch (err) {
      console.error(err);
      setTransResult("Lỗi kết nối.");
    }
    setIsTranslating(false);
  };

  // --- RENDER ---
  return (
    <div className="app-container">
      {/* SIDEBAR */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h2 className="app-title">🗺️ Bản đồ Du lịch</h2>
          <form className="search-form" onSubmit={e => e.preventDefault()}>
            <input
              className="search-input"
              type="text"
              placeholder="Nhập khu vực (VD: Đà Lạt)..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="search-button" disabled={loading} type="button">🔍</button>
          </form>
          <div className="quick-buttons">
            <button className="city-btn" onClick={() => setQuery("Hà Nội")}>Hà Nội</button>
            <button className="city-btn" onClick={() => setQuery("Huế")}>Huế</button>
            <button className="city-btn" onClick={() => setQuery("Sài Gòn")}>Sài Gòn</button>
          </div>
        </div>

        {(statusMsg || routeInfo) && (
          <div className="status-bar">
            {statusMsg && <div className="status-msg">{statusMsg}</div>}
            {routeInfo && <div className="route-info">🚗 Khoảng cách: {routeInfo.dist} km</div>}
          </div>
        )}

        <div className="scroll-area">
          {!nominatimResults.length && !places.length && !loading && (
            <div className="empty-state">Bắt đầu nhập để tìm kiếm...</div>
          )}

          {/* LIST: Nominatim Results */}
          {nominatimResults.map(result => (
            <div 
              key={result.place_id} 
              className="place-card"
              onClick={() => handleResultSelect(parseFloat(result.lat), parseFloat(result.lon), result.display_name)}
            >
              <div className="place-name">{result.display_name.split(',')[0]}</div>
              <div className="place-hint">{result.display_name}</div>
            </div>
          ))}

          {/* LIST: POI Results */}
          {places.map(place => (
            <div 
              key={place.id} 
              className={`place-card ${selectedPlaceId === place.id ? 'selected' : ''}`}
              onClick={() => {
                setSelectedPlaceId(place.id);
                setCenter([place.lat, place.lon]);
                setZoom(16);
                if(markerRefs.current[place.id]) markerRefs.current[place.id].openPopup();
              }}
            >
              <div className="place-name">{place.name}</div>
              <div className="place-details">
                <span className="place-tag">{place.type}</span>
              </div>
              {selectedPlaceId === place.id && (
                <button 
                  className="direction-btn"
                  onClick={(e) => { e.stopPropagation(); handleDirectionClick(place.lat, place.lon); }}
                >
                  📍 Chỉ đường
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* MAP */}
      <div className="map-wrapper">
        <MapContainer center={center} zoom={zoom} style={{ height: "100%", width: "100%" }} zoomControl={false}>
          <TileLayer attribution='&copy; OSM contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <RecenterMap center={center} zoom={zoom} />

          {searchAreaPoint && <Circle center={searchAreaPoint} radius={2000} pathOptions={{ color: '#dc3545', fillColor: '#dc3545', fillOpacity: 0.2 }} />}
          {myLocation && <Marker position={myLocation} icon={userIcon}><Popup>Vị trí của bạn</Popup></Marker>}

          {places.map(place => (
            <Marker 
              key={place.id} 
              position={[place.lat, place.lon]} 
              icon={poiIcon}
              ref={el => markerRefs.current[place.id] = el}
              eventHandlers={{ click: () => setSelectedPlaceId(place.id) }}
            >
              <Popup>
                <b>{place.name}</b><br/>{place.type}<br/>
                <button className="popup-btn" onClick={() => handleDirectionClick(place.lat, place.lon)}>Chỉ đường</button>
              </Popup>
            </Marker>
          ))}

          {routePath.length > 0 && <Polyline positions={routePath} color="#007bff" weight={5} opacity={0.8} />}
        </MapContainer>

        <div className="translation-widget">
            <h3 className="widget-title">🗣️ Dịch Anh - Việt</h3>
            <div className="trans-box">
              <input 
                type="text" 
                className="trans-input" 
                placeholder="Nhập text..." 
                value={transInput}
                onChange={(e) => setTransInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleTranslate()}
              />
              <button className="trans-btn" onClick={handleTranslate} disabled={isTranslating}>
                {isTranslating ? "." : "->"}
              </button>
            </div>
            {transResult && (
              <div className="trans-result">👉 {transResult}</div>
            )}
        </div>

        {/* WEATHER WIDGET */}
        {weatherData && (
          weatherData.error ? (
            <div className="weather-error">{weatherData.error}</div>
          ) : (
            <div className="weather-widget">
              <h3 className="weather-header">Thời tiết tại {weatherData.name}</h3>
              <div className="weather-content">
                <div className="weather-temp">{weatherData.temp}°C</div>
                <div className="weather-info">
                  {/* Hiển thị Nắng/Mưa ở đây */}
                  <div className="weather-desc" style={{fontWeight: "bold", fontSize: "16px"}}>
                    {weatherData.desc}
                  </div>
                  <div style={{fontSize: "12px", color: "#666", marginTop: "4px"}}>
                    Gió: {weatherData.wind} km/h
                  </div>
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}