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
- **Python**: 3.12 (khuyến nghị, xem `.python-version`); 3.14 cũng cài được (wheel đã kiểm tra)
- **Database**: PostgreSQL 16 (qua Docker Compose)
- **Docker & Docker Compose**
- **Node.js**: 20+ (cho Frontend)

### 2.2. Khởi chạy Database PostgreSQL
```bash
docker compose up -d
```
Container `dfios-postgres` chạy trên cổng `5432`, user `dfios`, database `dfios`. Mật khẩu mặc định `dfios123`
(chỉ cho máy cục bộ); đổi bằng biến `POSTGRES_PASSWORD` trong file `.env` cạnh `docker-compose.yml`
và cập nhật `DATABASE_URL` tương ứng. Compose có healthcheck (`pg_isready`).
Backend và Frontend tùy chọn chạy trong container: `docker compose --profile app up -d --build`
(cần `BE/.env`).

### 2.3. Cài đặt Backend

**PowerShell (Windows)**
```powershell
cd BE
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt          # thêm requirements-dev.txt nếu cần ruff
Copy-Item .env.example .env              # rồi điền giá trị (xem mục 4)
```

**bash (Linux/macOS/Git Bash)**
```bash
cd BE
python3.12 -m venv .venv
source .venv/bin/activate                # Git Bash trên Windows: source .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env
```

### 2.4. Artifact khoa học và dữ liệu M5 (bắt buộc)
Các file artifact (parquet, npz, csv, `MODEL/*`) **không nằm trong git**; chủ dự án gửi trực tiếp cho thành viên.
Danh sách file bắt buộc, vị trí và sha256 nằm ở `BE/scripts/artifacts_manifest.json`:
- `BE/scripts/`: `forecasts_Ensemble.parquet`, `quantiles_tft.parquet`, `production_forecast.parquet`,
  `production_sigma.parquet`, `tier2_input.parquet`, `c3ok_sku_class.csv`
- `BE/MODEL/`: `c3ok_forecasts.npz`, `best_params.json`, `ensemble_manifest.json`

Kiểm tra (báo lỗi rõ ràng, thoát mã 1 nếu thiếu hoặc sai nội dung):
```bash
cd BE
python scripts/check_artifacts.py
```
Có thể đặt thư mục artifact khác bằng `DFIOS_ARTIFACTS_DIR` (áp dụng cho nhóm `BE/scripts/`).

Dữ liệu M5 gốc (`sales_train_evaluation.csv`, `calendar.csv`, tùy chọn `sell_prices.csv`) tải từ cuộc thi
Kaggle "M5 Forecasting - Accuracy" và đặt đường dẫn vào `M5_SALES_CSV_PATH`, `M5_CALENDAR_CSV_PATH` trong `BE/.env`.

> **Điều khoản dữ liệu**: M5 là dữ liệu của Walmart công bố qua Kaggle, chỉ dùng cho mục đích học thuật/nghiên cứu
> theo điều khoản cuộc thi (https://www.kaggle.com/competitions/m5-forecasting-accuracy/rules). Không đưa dữ liệu gốc
> và các artifact dẫn xuất lên kho mã công khai.

### 2.5. Dựng cơ sở dữ liệu bằng MỘT lệnh
Từ thư mục `BE/` (đã có `BE/.env` hoặc biến môi trường `DATABASE_URL`, `M5_*`, `ADMIN_PASSWORD`,
`MANAGER_PASSWORD`, `VIEWER_PASSWORD`):
```bash
python scripts/bootstrap.py --reset
```
Thứ tự: kiểm tra artifact -> `init_tables` -> các loader (users, suppliers, calendar, events, products,
sales_history, forecast, inventory_params, c3out, inventory, ...) -> `seed_demo` -> `sync_scientific_baseline`.
In tiến độ và thời gian từng bước (khoảng 1 phút trên máy phát triển). Lỗi ở bước nào thì dừng và gợi ý
`--from <bước>` để chạy tiếp.
- `--reset`: DROP và tạo lại schema `public`. Từ chối nếu host của `DATABASE_URL` không phải `localhost`/`127.0.0.1`,
  trừ khi thêm `--i-know`.
- Không có `--reset`: chạy lại trên DB đã có dữ liệu (các loader idempotent).
- `--skip-checksum`: chỉ kiểm tra tồn tại và kích thước artifact.

### 2.6. Khởi chạy API
```bash
cd BE
uvicorn app.main:app --reload --port 8000
```
Swagger UI: [http://localhost:8000/docs](http://localhost:8000/docs). Phía sau reverse proxy, đặt
`TRUSTED_PROXIES` (IP/CIDR, phân tách dấu phẩy) thì header `X-Forwarded-For` mới được tin; mặc định không tin.

### 2.7. Khởi chạy Frontend (React + Vite)
```bash
cd FE
npm install
npm run dev
```
Giao diện chạy tại [http://localhost:5173](http://localhost:5173). Danh sách kho cho bộ chọn kho: `GET /api/v1/inventory/stores`.

---

## 3. Kiểm thử Tự động (Automated Tests)

Bộ test dùng `pytest` (SQLite in-memory, không cần PostgreSQL). Từ thư mục `BE/`:

**PowerShell**
```powershell
python -m pytest -q
```
**bash**
```bash
python -m pytest -q
```
Số lượng test hiện tại: xem dòng tổng kết của `pytest` (khoảng 240 test, mất vài phút).
Test cần artifact `MODEL/tft_model.pth` tự bỏ qua (skip) khi file không có trên máy.

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
SMTP_USER=your_account@gmail.com
SMTP_PASSWORD=your_16_character_app_password
EMAILS_FROM_EMAIL=your_account@gmail.com
EMAILS_FROM_NAME=DFIOS Notification
EMAILS_USE_TLS=True

# Thời hạn Token (TTL)
TOKEN_EXPIRE_ACTIVATE_HOURS=48
TOKEN_EXPIRE_RESET_PASSWORD_MINUTES=30
TOKEN_EXPIRE_CHANGE_EMAIL_HOURS=24
EMAIL_RATE_LIMIT_PER_HOUR=5
```

> **Lưu ý**: Nếu chưa điền `SMTP_USER` và `SMTP_PASSWORD`, hệ thống sẽ tự động chuyển sang chế độ **MockEmailSender** (in nội dung email và link token ra terminal console phục vụ việc test cục bộ mà không gặp lỗi).

