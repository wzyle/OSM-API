import React, { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import axios from "axios";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// --- CẤU HÌNH ICON CHO LEAFLET (Sửa lỗi mất icon mặc định) ---
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
});

// --- COMPONENT: TỰ ĐỘNG DI CHUYỂN BẢN ĐỒ ---
// Component này giúp bản đồ bay đến vị trí mới khi danh sách điểm thay đổi
function RecenterMap({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 0) {
      // Lấy tọa độ điểm đầu tiên để làm trung tâm
      const { lat, lon } = points[0];
      map.flyTo([lat, lon], 13);
    }
  }, [points, map]);
  return null;
}

export default function App() {
  const [query, setQuery] = useState("");
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(false);

  // Vị trí mặc định: TP. Hồ Chí Minh
  const defaultPosition = [10.8231, 106.6297];

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query) return;

    setLoading(true);
    try {
      // Gọi API Nominatim: Tìm "tourism" (du lịch) trong khu vực người dùng nhập
      // limit=5: Giới hạn 5 kết quả
      const response = await axios.get(
        `https://nominatim.openstreetmap.org/search?format=json&q=tourism+in+${query}&limit=5`
      );
      
      if (response.data.length > 0) {
        setPoints(response.data);
      } else {
        alert("Không tìm thấy địa điểm nào! Hãy thử tên thành phố lớn (VD: Hà Nội, Đà Lạt)");
        setPoints([]);
      }
    } catch (error) {
      console.error("Lỗi khi tìm kiếm:", error);
      alert("Có lỗi xảy ra khi gọi API");
    }
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* KHUNG TÌM KIẾM */}
      <div style={{ padding: "20px", background: "#f0f0f0", textAlign: "center" }}>
        <form onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="Nhập tên địa điểm (VD: Đà Lạt)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ padding: "10px", width: "300px", marginRight: "10px" }}
          />
          <button type="submit" style={{ padding: "10px 20px", cursor: "pointer" }} disabled={loading}>
            {loading ? "Đang tìm..." : "Tìm 5 điểm thú vị"}
          </button>
        </form>
      </div>

      {/* BẢN ĐỒ */}
      <div style={{ flex: 1 }}>
        <MapContainer center={defaultPosition} zoom={10} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          {/* Hiển thị các điểm Marker */}
          {points.map((point, index) => (
            <Marker key={index} position={[point.lat, point.lon]}>
              <Popup>
                <strong>{point.display_name.split(",")[0]}</strong> <br />
                {point.type}
              </Popup>
            </Marker>
          ))}

          {/* Component hỗ trợ di chuyển camara */}
          <RecenterMap points={points} />
        </MapContainer>
      </div>
    </div>
  );
}