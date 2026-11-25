# DFIOS - Demand Forecasting & Inventory Optimization System
> Hệ thống dự báo nhu cầu & tối ưu tồn kho thông minh bằng Machine Learning - Đồ án tốt nghiệp

DFIOS giải quyết bài toán cốt lõi trong chuỗi cung ứng bán lẻ (bộ dữ liệu Walmart M5): **dự báo nhu cầu** và **chính sách bổ sung tồn kho theo nhóm hàng** nhằm tối thiểu tổng chi phí vận hành (giữ kho + đặt hàng + mất bán) trong khi giữ mức phục vụ cam kết **availability ≥ 95% cho mọi nhóm ABC×XYZ** (J5 chọn tham số với đệm 96%).

---

## 1. Kiến trúc Giải thuật 3 Tầng (3-Tier Framework)

Hệ thống được thiết kế và cài đặt bám sát 100% đặc tả nghiên cứu lý thuyết:
1. **Tier 1 - Dự báo ML (Ensemble)**: hai engine.
   - *Production* (`dfios_forecast v1.0`): LightGBM 0,441 + XGBoost 0,078 + TFT 0,481 (LSTM trọng số 0), 30.490 chuỗi, 53 đặc trưng, dự báo 28 ngày tương lai, WRMSSE 0,4935 (tầm 7 ngày).
   - *Backtest* (`backtest-ensemble-v1`, dùng cho replay): LightGBM 0,548 + XGBoost 0,275 + MLP 0,202, 29 đặc trưng, huấn luyện lại theo mốc cắt d_1031 / d_1395, dự báo cuốn chiếu 1–14 ngày tại mỗi ngày gốc (chỉ dùng dữ liệu trước gốc).
   - Cầu nối route (c): Q̂(0,95) của tổng cửa sổ H = L + R = 10 ngày = dự báo + quantile sai số thực của 364 ngày trước.
2. **Tier 2 - REFIT-RSS-EOQ-G**: `s = ⌈Q̂·e^(m_g+θ_g)⌉`, `S = s + ⌈κ_g·EOQ⌉`, đặt `S − IP` khi `IP < s`. Mỗi 91 ngày (J5) quét lưới $(m_g, \kappa_g)$ trên 26 tuần gần nhất cho 9 nhóm ABC×XYZ, chọn cặp rẻ nhất theo chi phí A3 ($h = 0.002 \cdot \text{giá/ngày}, b = 0.35 \cdot \text{giá}, c = 2$) mà availability nhóm ≥ 96%.
3. **Tier 3 - C³-OUT**: bộ điều khiển vòng kín **một phía**, cập nhật mỗi kỳ review (J4): $\theta_g \leftarrow \text{clip}(\theta_g + \eta(e_{g,k-d} - 0.04), 0, 2)$, $\eta = 1$, trễ $d$ kỳ. Nhóm hết hàng quá 4% thì $\theta_g$ tăng, kéo $s$ lên.
4. Mặc định $L = 3$, $R = 7$; demo chạy trên kho CA_1 (3.049 SKU).

---

## 2. Hướng dẫn Khởi chạy Hệ thống

### 2.1. Yêu cầu Môi trường
- **Python**: 3.12 (khuyến nghị, xem `.python-version`); đã chạy với 3.13; 3.14 cũng cài được (wheel đã kiểm tra)
- **Database**: PostgreSQL 16 (qua Docker Compose)
- **Docker & Docker Compose**
- **Node.js**: 22+ (cho Frontend; Vitest 5 cần Node ≥ 21 để in lỗi test)

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
  `production_sigma.parquet`, `tier2_input.parquet`, `c3ok_sku_class.csv`, `c3ok_forecast_calibration.csv`
- `BE/MODEL/`: `c3ok_forecasts.npz`, `best_params.json`, `ensemble_manifest.json`, `c3ok_results.csv`,
  `c3ok_csl_by_class.csv`, `c3ok_config.json`

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
`MANAGER_PASSWORD`, `VIEWER_PASSWORD`, tùy chọn `PLANNER_PASSWORD`):
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

### 2.8. Năm replay đầy đủ (chỉ DB local `dfios_sandbox*`)
`bootstrap.py` chỉ nạp 28 ngày demo. Buổi demo chạy cả năm test của CA_1 trên một DB local tên bắt đầu bằng
`dfios_sandbox` (các script từ chối mọi DB khác, không bao giờ ghi lên Supabase). Lịch được dời đúng 548 tuần:
ngày đầu năm test d_1577 (25/05/2015) hiện là **thứ Hai 24/11/2025**, thứ trong tuần và mọi số liệu giữ nguyên.

**Cách A – nạp gói dump của nhóm (khuyến nghị, không cần dữ liệu nghiên cứu).** Chủ dự án gửi
`dfios_demo_full.dump` (đồng hồ ở ngày đầu, đã có dự báo backtest Ensemble và LightGBM):
```bash
docker compose up -d postgres
docker exec dfios-postgres createdb -U dfios -T template0 dfios_sandbox
docker cp dfios_demo_full.dump dfios-postgres:/tmp/full.dump
docker exec dfios-postgres pg_restore -U dfios -d dfios_sandbox --no-owner /tmp/full.dump
docker exec dfios-postgres rm /tmp/full.dump
# Git Bash trên Windows: chạy `export MSYS_NO_PATHCONV=1` trước, nếu không /tmp bị đổi thành đường dẫn Windows
```

**Cách B – dựng lại từ dữ liệu nghiên cứu** (thư mục `26FA_SET490_Inventory`, đặt `TEACHER_DIR`, khoảng 25 GB):
```bash
# tạo DB: docker exec dfios-postgres psql -U dfios -d dfios -c "create database dfios_sandbox template template0"
export DATABASE_URL=postgresql+psycopg2://dfios:dfios123@localhost:5432/dfios_sandbox DFIOS_LOCAL_ONLY=1
python scripts/bootstrap.py --reset
python scripts/load_teacher_data.py --store CA_1 --teacher-dir "$TEACHER_DIR"     # ~3 phút, 2,68 triệu dòng
python scripts/load_teacher_prices.py --store CA_1 --teacher-dir "$TEACHER_DIR"   # giá theo ngày
python scripts/load_teacher_data.py --store CA_1 --teacher-dir "$TEACHER_DIR" --steps sources daily \
    --source-models ensemble chronos_bolt                                          # nguồn đổi mô hình + dự báo backtest hằng ngày
python scripts/load_teacher_data.py --store CA_1 --teacher-dir "$TEACHER_DIR" --steps daily \
    --daily-models lgbm --daily-first-origin 1388                                  # LightGBM đơn lẻ cho bảng sai số
python scripts/shift_sandbox_calendar.py --to-start 2025-11-24                     # dời lịch 548 tuần
```
Kiểm chứng phương pháp: chạy hết năm test, engine ra đúng Bảng 17 (E10b) của báo cáo, 719.971 USD và 92.281 đơn
trên 3 kho (`tests/test_e10b_regression.py`, cần dữ liệu nghiên cứu).

**Snapshot cho buổi demo** (bản sao DB trong Postgres, khôi phục khoảng 1–2 phút; mỗi bản ~2 GB trong đĩa ảo Docker,
cần vài GB trống và đủ RAM, nên đóng bớt ứng dụng trước khi chạy):
```bash
python scripts/demo_snapshot.py save demo_start      # lưu ngay sau khi nạp: đồng hồ 24/11/2025, chưa tua
python scripts/demo_snapshot.py restore demo_start   # dừng API đang dùng dfios_sandbox trước, hoặc thêm --force
python scripts/demo_snapshot.py list
```
Chạy API trên DB này: `DATABASE_URL=...dfios_sandbox DFIOS_LOCAL_ONLY=1 DFIOS_SCHEDULER=0 uvicorn app.main:app --port 8000`.
Tham số mô phỏng h, b, c sửa ở Cài đặt → Hệ thống (chỉ khi đồng hồ còn ở ngày đầu); L, R cố định 3 và 7.

**Đổi mô hình (demo bước 10, E9c)**: nạp quantile của từng mô hình làm nguồn (một lần), rồi Admin kích hoạt:
```bash
python scripts/load_teacher_data.py --store CA_1 --teacher-dir "$TEACHER_DIR" --steps sources \
    --source-models ensemble chronos_bolt
# POST /api/v1/forecast-sources/activate {"store_id": "CA_1", "model": "chronos_bolt"}   (Admin)
# rollback: cùng lệnh với "model": "ensemble";  GET /api/v1/forecast-sources: mô hình đang dùng + lịch sử
```
Chỉ các kỳ review mà đồng hồ chưa tới bị thay quantile (quyết định đã có không đổi). Kích hoạt ở 22/11/2015 cho kết
quả trùng khớp từng con số với kịch bản `--switch-from ensemble --switch-to chronos_bolt --switch-day 1759`.

### 2.9. Planner duyệt đơn trong vòng lặp và batch job
- `POST /api/v1/clock/advance` với `"approval_mode": "planner"`: lệnh tua dừng ở kỳ review kế tiếp, đơn của kỳ đó ở
  trạng thái PENDING. Planner sửa (`PATCH /replenishments/{id}`, bắt buộc lý do) và duyệt
  (`POST /replenishments/{id}/approve`); số đã duyệt (`final_qty`) về kho sau L = 3 ngày. Lệnh tua tiếp theo trả
  409 khi còn đơn chờ duyệt, trừ khi gửi `"expire_pending": true` (đơn đó bị bỏ, không đặt hàng). Mặc định
  `"approval_mode": "auto"` giữ nguyên hành vi cũ (replay, test tương đương).
- Vai trò **Planner** (`planner@dfios.com`, tạo khi đặt `PLANNER_PASSWORD`): xem dự báo, sửa dự báo có lý do, sửa và
  duyệt đơn. Manager có mọi quyền của Planner, thêm chạy J5 (`POST /optimization/refit-policies`).
- Mỗi lệnh tua ghi `batch_runs` (ADVANCE, J1, J3-J6, J5: trạng thái, thời lượng ms, lỗi):
  `GET /api/v1/batch-runs`, `GET /api/v1/batch-runs/{run_id}` (số liệu E7). Thêm `"async_job": true` vào lệnh tua
  hoặc J5 để nhận ngay `202 + run_id` rồi theo dõi bằng `GET /batch-runs/{run_id}`.

### 2.10. Chạy toàn bộ bằng Docker Compose
```bash
docker compose --profile app up -d --build
```
Các container: `postgres` (db), `backend` (api), `worker` (`python -m app.worker`: chạy batch job và lịch batch),
`frontend` (web), `nginx` (một cổng duy nhất [http://localhost:8080](http://localhost:8080), `/api` → backend).
Trong compose, API chỉ xếp job vào hàng đợi (`DFIOS_BATCH_EXECUTOR=queue`), worker nhận và chạy. Chạy trực tiếp trên
máy (mục 2.6) thì job chạy trên một thread nền của API, không cần worker. HTTPS: gắn chứng chỉ vào
`deploy/nginx/default.conf` (`listen 443 ssl`); cấu hình mặc định chỉ có HTTP cho máy local.

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
Số lượng test hiện tại: xem dòng tổng kết của `pytest` (khoảng 560 test, mất vài phút).
Test cần artifact `MODEL/tft_model.pth` tự bỏ qua (skip) khi file không có trên máy.

**Frontend unit test** (từ `FE/`): `npm test` (Vitest).

**E2E Playwright** (demo.md §8: các bước 2, 6, 7 của kịch bản demo và kiểm tra quyền Admin / Planner).
Chạy trên stack đang chạy: BE (`uvicorn`, **chỉ DB local**, vì test đặt lại đồng hồ mô phỏng) và FE (`npm run dev`).
Cần tài khoản Planner: đặt `PLANNER_PASSWORD` trong `BE/.env` rồi chạy `python scripts/load_users.py`.

```bash
cd FE
npx playwright install chromium          # một lần (hoặc đặt PW_CHROMIUM_PATH tới một Chromium có sẵn)
export E2E_ADMIN_EMAIL=admin@dfios.com E2E_ADMIN_PASSWORD=...        # lấy từ BE/.env, không commit
export E2E_PLANNER_EMAIL=planner@dfios.com E2E_PLANNER_PASSWORD=...  # tùy chọn
npm run e2e
```
Các test: đăng nhập và Dashboard (bước 2); tua 1 kỳ review rồi kiểm tra dòng ADVANCE trong Lịch sử batch (bước 7);
tua 1 kỳ ở chế độ "Planner duyệt", mở đề xuất chờ duyệt từ banner, sửa số lượng có lý do, duyệt, xuất CSV (bước 6);
Admin thấy Lịch sử batch / Phiên bản mô hình / Chính sách đang áp dụng; Planner không thấy điều khiển đồng hồ.
Thiếu biến `E2E_ADMIN_*` thì test tự bỏ qua.

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

