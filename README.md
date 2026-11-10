# NBCare Core — Dược Sĩ Lâm Sàng Ảo & Hệ Thống Bình Đơn Thuốc

Phiên bản độc lập chuyên biệt được thiết kế cho **Bệnh viện Đa khoa tỉnh Ninh Bình**:
- **Tách biệt 2 Module**:
  1. 💬 **Module 1 — Chatbot Dược Lâm Sàng**: Tra cứu thông tin thuốc, chỉ định, tương tác, hiệu chỉnh liều, đọc ảnh thuốc qua OCR.
  2. 📋 **Module 2 — Bình Đơn Thuốc Lâm Sàng**: Rà soát, thẩm định đơn thuốc chuyên sâu với hệ thống cảnh báo mức độ 🔴 Đỏ / 🟡 Vàng / 🟢 Xanh và đề xuất can thiệp dược.
- **Không yêu cầu đăng nhập**: Loại bỏ hoàn toàn rào cản tài khoản/mật khẩu hay mã PIN chuyên sâu.
- **Thay thế API MedCheck bằng Google Vertex Agent / Gemini**: Tận dụng hạ tầng suy luận của Vertex AI và Gemini API với grounding chặt chẽ.
- **Giữ nguyên CSDL chuẩn**: Kế thừa trọn vẹn CSDL hiệu chỉnh liều theo MLCT (187 hoạt chất), kho tương kỵ Ysite và danh mục DrugView Ninh Bình.

---

## 🚀 Khởi chạy nhanh (Chỉ cần Node.js)

Dự án sử dụng Node.js 20+ thuần (ESM native), **không cần cài đặt thư viện ngoài (zero-dependency)**:

```powershell
cd C:\Users\Admin\.gemini\antigravity\scratch\nbcare-clone
npm start
```

Mở trình duyệt truy cập: **http://127.0.0.1:8788/**

---

## ⚙️ Cấu hình Vertex Agent / Gemini

Sao chép tệp `.env.example` thành `.env` và điền khóa của bạn:

```env
PORT=8788
GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-2.5-flash
```

*(Lưu ý: Nếu chưa nhập khóa API, hệ thống vẫn khởi chạy mượt mà ở chế độ CSDL lâm sàng nội bộ với dữ liệu DrugView và 187 hoạt chất MLCT có sẵn).*

---

## 📁 Cấu trúc thư mục

```
nbcare-clone/
├── backend/
│   ├── clinical_db.mjs       # Bộ nạp và tra cứu CSDL DrugView & MLCT
│   └── vertex_agent.mjs      # Engine kết nối Vertex Agent / Gemini AI
├── data/
│   ├── mlct-index.json       # Chỉ mục 187 hoạt chất hiệu chỉnh liều
│   └── mlct-drugs/           # 187 tệp dữ liệu chi tiết từng thuốc
├── assets/                   # Phông chữ, logo BVĐK Ninh Bình, Tesseract OCR
├── index.html                # Giao diện chính tách 2 module
├── style.css                 # Thiết kế giao diện y tế hiện đại
├── chat_module.js            # Logic Module 1: Chatbot tra cứu
├── review_module.js          # Logic Module 2: Bình đơn lâm sàng
├── server.mjs                # Máy chủ Node.js REST API
├── .env.example              # Mẫu biến môi trường
└── package.json
```
