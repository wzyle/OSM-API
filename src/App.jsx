import React, { useState, useEffect, useRef, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline, Circle } from "react-leaflet";
import axios from "axios";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import "./App.css"; // Import file CSS
import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "firebase/auth";
import { getDatabase, ref, push, onValue, remove } from "firebase/database";

// ... import xong

const AI_API_URL = "https://organologic-cathern-mooned.ngrok-free.dev";

const firebaseConfig = {
  apiKey: "AIzaSyBVAvBliq8Arfy_W5-LWoh4Zz5pZQKrzHE", 
  authDomain: "travelapp-72671.firebaseapp.com",
  databaseURL: "https://travelapp-72671-default-rtdb.asia-southeast1.firebasedatabase.app", // Quan trọng để lưu địa điểm [cite: 112]
  projectId: "travelapp-72671",
  storageBucket: "travelapp-72671.firebasestorage.app",
  messagingSenderId: "269592970760",
  appId: "1:269592970760:web:fb6a9e6e72ad73c083f3bd"
};

// Khởi tạo kết nối [cite: 35]
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

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
  const [destinationMarker, setDestinationMarker] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [weatherData, setWeatherData] = useState(null);
  const [transInput, setTransInput] = useState("");
  const [transResult, setTransResult] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [user, setUser] = useState(null);             // Lưu user đăng nhập [cite: 6]
  const [savedPlaces, setSavedPlaces] = useState([]); // List địa điểm đã lưu
  const [showSavedTab, setShowSavedTab] = useState(false); // Chuyển tab
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [isAiOpen, setIsAiOpen] = useState(true);

  const markerRefs = useRef({});

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Nếu đã đăng nhập, tự động tải dữ liệu về [cite: 120]
        const savedRef = ref(db, `users/${currentUser.uid}/saved_places`);
        onValue(savedRef, (snapshot) => {
          const data = snapshot.val();
          const list = data ? Object.entries(data).map(([key, val]) => ({ firebaseKey: key, ...val })) : [];
          setSavedPlaces(list);
        });
      } else {
        setSavedPlaces([]);
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. Hàm Đăng nhập Google [cite: 126]
  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      // Dùng signInWithPopup thay vì redirect để tránh reload trang
      const result = await signInWithPopup(auth, provider);
      console.log("User Info:", result.user); // Xem thông tin user trả về
    } catch (error) {
      console.error("Lỗi đăng nhập:", error.code, error.message);
      alert(`Đăng nhập thất bại: ${error.message}`); // Hiển thị thông báo lỗi cụ thể lên màn hình
    }
  };

  // 3. Hàm Lưu địa điểm [cite: 118]
  const handleSavePlace = async (place) => {
    if (!user) return alert("Vui lòng đăng nhập!");
    try {
      const savedRef = ref(db, `users/${user.uid}/saved_places`);
      await push(savedRef, {
        id: place.id, name: place.name, lat: place.lat, lon: place.lon, type: place.type
      });
      alert("Đã lưu!");
    } catch (error) {
      console.error("Lỗi lưu địa điểm:", error);
      alert("Lỗi lưu địa điểm!");
    }
  };

  // Remove a saved place by firebase key
  const handleRemoveSaved = async (firebaseKey) => {
    if (!user) return alert("Vui lòng đăng nhập!");
    try {
      const itemRef = ref(db, `users/${user.uid}/saved_places/${firebaseKey}`);
      await remove(itemRef);
      alert("Đã xóa địa điểm.");
    } catch (err) {
      console.error("Lỗi xóa địa điểm:", err);
      alert("Lỗi xóa địa điểm.");
    }
  };

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
    setDestinationMarker(null);
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
      setDestinationMarker([endLat, endLon]);
      setCenter([endLat, endLon]);
      setZoom(14);
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

  const handleAskAI = async () => {
    if (!aiQuestion.trim()) return;
    setIsAiThinking(true);
    setAiAnswer(""); // Reset câu trả lời cũ
    
    try {
      // Gửi request POST đến endpoint /ask-ai trên Colab
      const res = await axios.post(`${AI_API_URL}/ask-ai`, {
        question: aiQuestion
      });
      // Giả sử backend trả về JSON dạng { "answer": "..." }
      setAiAnswer(res.data.answer);
    } catch (err) {
      console.error(err);
      setAiAnswer("⚠️ Lỗi kết nối Server AI (Check lại Colab/Ngrok).");
    }
    setIsAiThinking(false);
  };

  // --- RENDER ---
  return (
    <div className="app-container">
      {/* SIDEBAR */}
      <div className="sidebar">
        <div style={{padding: "10px 20px", background: "#f1f1f1", display: "flex", justifyContent: "space-between"}}>
          {user ? (
            <div>
               <b>{user.displayName}</b> 
               <button onClick={() => signOut(auth)} style={{marginLeft:"5px", fontSize:"11px"}}>Thoát</button>
            </div>
          ) : (
            <button onClick={handleLogin} style={{width:"100%", background:"#4285F4", color:"white", border:"none", padding:"5px"}}>
              Đăng nhập Google
            </button>
          )}
        </div>
        <div className="sidebar-header">
          <h2 className="app-title">🗺️ Bản đồ Du lịch</h2>
          <div style={{display:"flex", gap:"10px", marginBottom:"10px"}}>
            <button onClick={() => setShowSavedTab(false)} style={{flex:1}}>🔍 Tìm kiếm</button>
            <button onClick={() => setShowSavedTab(true)} style={{flex:1}}>❤️ Đã lưu ({savedPlaces.length})</button>
          </div>
          {!showSavedTab && (
            <>
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
            </>
          )}
        </div>

        {!showSavedTab && (statusMsg || routeInfo) && (
          <div className="status-bar">
            {statusMsg && <div className="status-msg">{statusMsg}</div>}
            {routeInfo && <div className="route-info">🚗 Khoảng cách: {routeInfo.dist} km</div>}
          </div>
        )}

        <div className="scroll-area">
          {/* --- TRƯỜNG HỢP 1: ĐANG Ở TAB TÌM KIẾM --- */}
          {!showSavedTab ? (
            <>
              {/* Nếu chưa tìm gì cả thì hiện hướng dẫn */}
              {!nominatimResults.length && !places.length && !loading && (
                <div className="empty-state">Bắt đầu nhập để tìm kiếm...</div>
              )}

              {/* Danh sách kết quả gợi ý từ Nominatim */}
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

              {/* Danh sách địa điểm vui chơi (POI) */}
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
                        {/* Nếu đã đăng nhập: hiển thị Lưu hoặc Xóa tùy trạng thái */}
                        {user && (() => {
                          const savedEntry = savedPlaces.find(sp => String(sp.id) === String(place.id));
                          if (savedEntry) {
                            return (
                              <button
                                className="delete-btn"
                                style={{marginLeft: "auto"}}
                                onClick={(e) => { e.stopPropagation(); handleRemoveSaved(savedEntry.firebaseKey); }}
                              >
                                🗑️ Xóa
                              </button>
                            );
                          }
                          return (
                            <button
                              className="save-btn"
                              style={{marginLeft:"auto", border:"none", background:"transparent", cursor:"pointer", color:"#dc3545", fontWeight:"bold"}}
                              onClick={(e) => {e.stopPropagation(); handleSavePlace(place)}}
                            >
                              ❤️ Lưu
                            </button>
                          );
                        })()}
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
            </>
          ) : (
            /* --- TRƯỜNG HỢP 2: ĐANG Ở TAB ĐÃ LƯU --- */
            <>
              {savedPlaces.length === 0 ? (
                <div className="empty-state">Bạn chưa lưu địa điểm nào.</div>
              ) : (
                savedPlaces.map(place => (
                  <div 
                    key={place.firebaseKey} 
                    className="place-card" 
                    onClick={() => { setCenter([place.lat, place.lon]); setZoom(16); }}
                  >
                    <div className="place-name">{place.name}</div>
                      <div className="place-details">
                          <span className="place-tag">{place.type}</span>
                          <button className="delete-btn" style={{marginLeft: "8px"}} onClick={(e) => { e.stopPropagation(); handleRemoveSaved(place.firebaseKey); }}>🗑️ Xóa</button>
                      </div>
                      <button 
                        className="direction-btn" 
                        onClick={(e) => { e.stopPropagation(); handleDirectionClick(place.lat, place.lon); }}
                      >
                        📍 Chỉ đường
                      </button>
                  </div>
                ))
              )}
            </>
          )}
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

          {/* Saved places markers (only show when viewing Saved tab) */}
          {showSavedTab && savedPlaces.map(place => (
            <Marker
              key={place.firebaseKey}
              position={[place.lat, place.lon]}
              icon={poiIcon}
              eventHandlers={{ click: () => setSelectedPlaceId(place.firebaseKey) }}
            >
              <Popup>
                <b>{place.name}</b><br/>{place.type}<br/>
                <button className="popup-btn" onClick={() => handleDirectionClick(place.lat, place.lon)}>Chỉ đường</button>
              </Popup>
            </Marker>
          ))}

          {/* Destination marker shown when a route is drawn */}
          {destinationMarker && (
            <Marker position={destinationMarker} icon={poiIcon}>
              <Popup>Điểm đến</Popup>
            </Marker>
          )}

          {routePath.length > 0 && <Polyline positions={routePath} color="#007bff" weight={5} opacity={0.8} />}
        </MapContainer>

        {/* 1. WIDGET AI (GÓC TRÊN PHẢI - CÓ NÚT THU GỌN) */}
        <div style={{ position: "absolute", top: "10px", right: "10px", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <button 
            onClick={() => setIsAiOpen(!isAiOpen)}
            style={{ marginBottom: "5px", padding: "6px 12px", borderRadius: "20px", border: "none", background: "#6f42c1", color: "white", fontWeight: "bold", cursor: "pointer", boxShadow: "0 2px 5px rgba(0,0,0,0.2)" }}
          >
            {isAiOpen ? "🔽 Ẩn AI" : "🤖 Hỏi AI"}
          </button>

          {isAiOpen && (
            <div style={{ width: "280px", background: "rgba(255, 255, 255, 0.95)", padding: "12px", borderRadius: "8px", boxShadow: "0 4px 15px rgba(0,0,0,0.15)", border: "1px solid #ddd" }}>
                <div style={{display:"flex", gap:"5px"}}>
                  <input 
                    type="text" 
                    placeholder="Hỏi địa điểm..." 
                    value={aiQuestion} 
                    onChange={(e) => setAiQuestion(e.target.value)} 
                    onKeyDown={(e) => e.key === 'Enter' && handleAskAI()}
                    style={{flex:1, padding:"6px", border:"1px solid #ccc", borderRadius:"4px", fontSize:"13px"}}
                  />
                  <button onClick={handleAskAI} disabled={isAiThinking} style={{background:"#6f42c1", color:"white", border:"none", borderRadius:"4px", padding:"0 10px", cursor:"pointer"}}>
                    {isAiThinking ? "..." : "➤"}
                  </button>
                </div>
                {aiAnswer && (
                  <div style={{marginTop:"8px", padding:"8px", background:"#f3f0ff", borderRadius:"4px", fontSize:"12px", color:"#333", maxHeight:"120px", overflowY:"auto", lineHeight: "1.4"}}>
                    {aiAnswer}
                  </div>
                )}
            </div>
          )}
        </div>

        {/* 2. WIDGET THỜI TIẾT (GÓC DƯỚI PHẢI - ĐÃ SỬA LỖI DÀI DÒNG) */}
        {weatherData && !weatherData.error && (
          <div style={{
            position: "absolute", bottom: "25px", right: "10px", zIndex: 900,
            background: "white", padding: "8px 12px", borderRadius: "8px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.15)", display: "flex", alignItems: "center", gap: "10px",
            maxWidth: "200px" // Giới hạn chiều rộng tối đa để không bị dài
          }}>
            <div style={{fontSize: "28px"}}>
               {weatherData.desc.includes("Mưa") ? "🌧️" : weatherData.desc.includes("Nắng") ? "☀️" : "⛅"}
            </div>
            <div style={{overflow: "hidden"}}>
              {/* Cắt ngắn tên địa điểm nếu quá dài */}
              <div style={{fontWeight: "bold", fontSize: "13px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>
                {weatherData.name}
              </div>
              <div style={{fontSize: "18px", fontWeight: "bold", color: "#333", lineHeight: "1.2"}}>
                {weatherData.temp}°C
              </div>
              {/* Cắt ngắn mô tả thời tiết */}
              <div style={{fontSize: "11px", color: "#666", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>
                {weatherData.desc}
              </div>
            </div>
          </div>
        )}

        {/* 3. WIDGET DỊCH (GÓC DƯỚI TRÁI - GỌN GÀNG) */}
        <div style={{
            position: "absolute", bottom: "25px", left: "10px", zIndex: 900,
            background: "white", padding: "10px", borderRadius: "8px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.15)", width: "220px"
        }}>
            <div style={{display: "flex", gap: "5px"}}>
              <input 
                type="text" 
                placeholder="Dịch Anh-Việt..." 
                value={transInput}
                onChange={(e) => setTransInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleTranslate()}
                style={{flex: 1, padding: "5px", borderRadius: "4px", border: "1px solid #ccc", fontSize: "12px"}}
              />
              <button onClick={handleTranslate} disabled={isTranslating} style={{padding: "5px 8px", background: "#17a2b8", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "12px"}}>
                {isTranslating ? "..." : "Dịch"}
              </button>
            </div>
            {transResult && (
              <div style={{marginTop: "5px", fontSize: "12px", color: "#007bff", fontWeight: "bold", borderTop: "1px solid #eee", paddingTop: "4px"}}>
                👉 {transResult}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}