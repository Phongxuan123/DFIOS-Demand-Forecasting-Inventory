# DFIOS - Demand Forecasting & Inventory Optimization System
> Hệ thống dự báo nhu cầu & tối ưu tồn kho thông minh bằng Machine Learning - Đồ án tốt nghiệp

DFIOS giải quyết bài toán cốt lõi trong chuỗi cung ứng bán lẻ (bộ dữ liệu Walmart M5): **Dự báo nhu cầu 28 ngày ($h = 1..28$)** và **Tối ưu hóa chính sách bổ sung tồn kho đa tầng** nhằm tối thiểu hóa tổng chi phí vận hành (Holding + Ordering + Stockout Cost) trong khi đảm bảo mức phục vụ cam kết (SLA $\ge 96\%$).

---

## 1. Kiến trúc Giải thuật 3 Tầng (3-Tier Framework)

Hệ thống được thiết kế và cài đặt bám sát 100% đặc tả nghiên cứu lý thuyết:
1. **Tier 1 - Ensemble Probabilistic Forecasting**: Mô hình dự báo tổ hợp (Temporal Fusion Transformer, LightGBM, SARIMA) xuất dự báo điểm và phân vị xác suất P10/P50/P90 cho 3.049 mặt hàng (SKU) tại 10 siêu thị.
2. **Tier 2 - Offline Policy Selection (REFIT-RSS-EOQ-G)**: Định kỳ theo Quý (Job J5), quét lưới ứng viên $(m_g, \kappa_g)$ trên 9 phân khúc ABC/XYZ để tìm chính sách tối thiểu chi phí mô hình A3 ($h = 0.002 \cdot \text{price/ngày}, c = 2.0, b = 0.35 \cdot \text{price}$) thỏa mãn ràng buộc mức phục vụ.
3. **Tier 3 - C³-OUT Online Feedback Calibration**: Bộ điều khiển tích hợp phản hồi vòng kín (Closed-Loop) hàng tuần (Job J4) với quy ước biên chống bão hòa (Anti-windup $\pm 2.0$, $L = 3, R = 7, H = 10$). Hệ số $\theta_g$ tự động bù trừ sai lệch phân phối thực tế của từng nhóm.

---

## 2. Hướng dẫn Khởi chạy Hệ thống

### 2.1. Yêu cầu Môi trường
- **Python**: 3.13+
- **Database**: PostgreSQL 16
- **Docker & Docker Compose**: Để chạy container cơ sở dữ liệu
- **Node.js**: 20+ (cho Frontend)

### 2.2. Khởi chạy Database PostgreSQL
Khởi chạy container PostgreSQL 16 qua Docker Compose:
```bash
docker compose up -d
```
Container `dfios-postgres` sẽ chạy trên cổng mặc định `5432` với cơ sở dữ liệu `dfios`.

### 2.3. Khởi tạo & Chạy Backend (FastAPI)
1. Cài đặt các thư viện phụ thuộc:
   ```bash
   pip install -r BE/requirements.txt
   ```
2. Cấu hình biến môi trường tại `BE/.env` (tham khảo file `BE/.env.example` hoặc mục 3 bên dưới).
3. Khởi tạo bảng dữ liệu và nạp baseline thực nghiệm M5:
   ```bash
   python BE/scripts/sync_scientific_baseline.py
   ```
4. Khởi chạy máy chủ API:
   ```bash
   cd BE
   uvicorn app.main:app --reload --port 8000
   ```
   API Swagger UI sẽ có sẵn tại: [http://localhost:8000/docs](http://localhost:8000/docs)

### 2.4. Khởi chạy Frontend (React + Vite)
```bash
cd FE
npm install
npm run dev
```
Giao diện người dùng sẽ chạy tại: [http://localhost:5173](http://localhost:5173)

---

## 3. Kiểm thử Tự động (Automated Unit Tests)

Toàn bộ 208 unit tests bảo toàn logic nghiệp vụ, giải thuật toán học và tính toàn vẹn của hệ thống:
```bash
# Đặt PYTHONPATH về BE và chạy toàn bộ test suite
$env:PYTHONPATH='BE'
python -m unittest discover -s BE/tests -p "test_*.py"
```

---

## 4. Cấu hình Email SMTP & Xác thực Email (Backend)

Hệ thống sử dụng cơ chế xác thực token một lần (one-time token) gửi qua email cho 3 luồng:
1. **Kích hoạt tài khoản (UC06)**: Admin tạo người dùng, người dùng nhận link để tự đặt mật khẩu lần đầu.
2. **Đặt lại mật khẩu (UC03)**: Nhận link đặt lại mật khẩu trong 30 phút.
3. **Đổi email liên hệ (UC05)**: Gửi link xác nhận đến email mới và cảnh báo bảo mật đến email cũ.

---

### Hướng dẫn lấy Gmail App Password (Mật khẩu ứng dụng)

Nếu bạn sử dụng tài khoản Gmail cá nhân để gửi email SMTP trong môi trường Development:

1. Đăng nhập tài khoản Google của bạn tại: [https://myaccount.google.com/](https://myaccount.google.com/)
2. Vào mục **Bảo mật (Security)** $\rightarrow$ Bật **Xác minh 2 bước (2-Step Verification)** (nếu chưa bật).
3. Tìm kiếm **Mật khẩu ứng dụng (App passwords)** trên thanh tìm kiếm của trang quản lý tài khoản Google.
4. Đặt tên ứng dụng (ví dụ: `DFIOS Backend`) và bấm **Tạo (Create)**.
5. Google sẽ cấp cho bạn một chuỗi mật khẩu 16 ký tự (ví dụ: `abcd efgh ijkl mnop`).
6. Dán mật khẩu này (viết liền không khoảng trắng) vào biến `SMTP_PASSWORD` trong file `BE/.env`.

---

### Các biến môi trường cần thiết trong `BE/.env`

```ini
# Frontend URL (Dùng để sinh link trong nội dung email)
FRONTEND_BASE_URL=http://localhost:5173

# Cấu hình SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=nguyensuminhnhat@gmail.com
SMTP_PASSWORD=your_16_character_app_password
EMAILS_FROM_EMAIL=nguyensuminhnhat@gmail.com
EMAILS_FROM_NAME=DFIOS Notification
EMAILS_USE_TLS=True

# Thời hạn Token (TTL)
TOKEN_EXPIRE_ACTIVATE_HOURS=48
TOKEN_EXPIRE_RESET_PASSWORD_MINUTES=30
TOKEN_EXPIRE_CHANGE_EMAIL_HOURS=24
EMAIL_RATE_LIMIT_PER_HOUR=5
```

> **Lưu ý**: Nếu chưa điền `SMTP_USER` và `SMTP_PASSWORD`, hệ thống sẽ tự động chuyển sang chế độ **MockEmailSender** (in nội dung email và link token ra terminal console phục vụ việc test cục bộ mà không gặp lỗi).

