# DFIOS Backend — Task List hợp nhất (37 UC còn lại)

Stack: **FastAPI · SQLAlchemy · PostgreSQL**, prefix `/api/v1`. Hiện có **17/50 UC xong, 78 test pass**. File này gộp danh sách của Gemini (endpoint, công thức, giá trị mặc định cụ thể) với thứ tự theo phụ thuộc dữ liệu. Tick `[x]` khi task xong và test pass.

> Dán nguyên file hoặc từng Phase cho agent. Làm **tuần tự theo Phase**, Phase nào xong phải pass test rồi mới sang Phase sau.

---

## Quy tắc chung (áp dụng cho MỌI task)

1. **Bám đúng cấu trúc 13 UC đã làm** (`products`, `suppliers`, `inventory`, `sales`, `events_calendar`, `audit_logs`): cùng cách tổ chức router / schema / service / model / test. Không tự đổi kiến trúc.
2. **Phân quyền** dùng đúng cơ chế JWT + role đang có. Sai role trả 403, chưa đăng nhập trả 401. Role lấy từ SRS (ghi ở từng task).
3. **Audit log**: mọi thao tác ghi (tạo, sửa, duyệt, từ chối, override, đổi cấu hình, chạy job) phải ghi vào `audit_logs`, đủ giá trị cũ → mới khi là sửa/cấu hình.
4. **Test**: mỗi task có test happy path, sai role, input không hợp lệ. Giữ 100% test pass, **không sửa test cũ để cho qua**.
5. **Migration**: thêm bảng/cột thì có migration, không sửa tay DB. Trước khi tính toán, kiểm tra field đầu vào đã có chưa (lead time, chi phí đặt hàng S, chi phí lưu kho H, MOQ, pack size, unit price). Thiếu thì thêm migration và **nói rõ trong báo cáo**, không tự bịa số.
6. **Tái dùng, không viết lại**: SSE event bus (`GET /api/v1/events`), service cập nhật tồn kho (`inventory`), audit service.
7. **Mỗi task xong** báo lại: file tạo/sửa, endpoint mới, kết quả test.
8. SRS mơ hồ thì chọn phương án đơn giản nhất, ghi giả định vào docstring, **không dừng lại hỏi**.
9. **Tiêu chuẩn code**: Không code lan man, không viết code quá dài thừa thãi; tối ưu code sạch sẽ, súc tích và hiệu quả nhất (KISS, DRY). Tuyệt đối không bịa code, không bịa framework/library ngoài stack chuẩn của dự án.

---

## Tiến độ

| Module | Tên | UC | Xong | Phase |
|:--:|---|:--:|:--:|:--:|
| A | Authentication & Access | 6 | 6/6 ✅ | — |
| C | Master Data & Inventory | 6 | 6/6 ✅ | — |
| I | System Administration | 2 | 2/2 ✅ | 0 |
| J | ML Pipeline & Model Ops | 5 | 3/5 | 1, 8 |
| D | Demand Forecasting | 8 | 8/8 ✅ | 2 |
| E | ABC/XYZ Classification | 4 | 4/4 ✅ | 3 |
| F | Inventory Optimization | 4 | 4/4 ✅ | 4 |
| G | Replenishment | 6 | 0/6 | 5 |
| B | Dashboard & Alerts | 4 | 0/4 | 6 |
| H | Reports & Analytics | 5 | 0/5 | 7 |

**Vì sao thứ tự này:** Dashboard cần ROP/SS (Phase 4), ROP/SS cần dự báo (Phase 2), dự báo cần model (Phase 1). Làm Dashboard đầu tiên sẽ phải làm lại.

---

## Phase 0 — Nền tảng cấu hình

- [x] **T01 · UC44 — Configure General System Settings** · `Admin` ghi, mọi role đã đăng nhập đọc
  - `GET /api/v1/settings`, `PUT /api/v1/settings/{key}`
  - Bảng `system_settings` (key/value có kiểu). Key: múi giờ, đơn vị tiền tệ, ngưỡng cảnh báo mặc định, `forecast_horizons` (mặc định 7/14/28).
  - Validate kiểu và khoảng giá trị. Mỗi lần đổi ghi audit (cũ → mới).

---

## Phase 1 — ML Pipeline lõi

- [x] **T02 · UC46 — Check Data Quality / Leakage Prevention** · `Admin`
  - `POST /api/v1/ml/data-quality/run`, `GET /api/v1/ml/data-quality/{run_id}`
  - Kiểm tra: tỷ lệ missing, outlier, nhất quán (ngày trùng, giá trị âm, SKU không tồn tại). **Leakage**: không đặc trưng nào dùng dữ liệu sau thời điểm dự báo; split theo thời gian.
  - Kết quả theo SKU: số liệu, mức nghiêm trọng, cờ pass/fail.

- [x] **T03 · UC47 — Train & Benchmark Forecasting Models** · `Admin`
  - `POST /api/v1/ml/train`, `GET /api/v1/ml/train/{job_id}`
  - Input: khoảng thời gian, danh sách SKU, danh sách mô hình. Metric: MAE, RMSE, MASE, WRMSSE.
  - **Bất đồng bộ** (background task / job queue), trạng thái `pending/running/done/failed`, poll được.
  - Dùng covariate từ lịch sự kiện (UC16). Split theo thời gian, không shuffle.
  - **Làm trước LightGBM + XGBoost + một baseline thống kê.** ARIMA/LSTM/TFT làm sau, chưa làm thì trả lỗi rõ ràng chứ không bỏ qua âm thầm.

- [x] **T04 · UC48 — Log Experiment & Manage Model Registry** · `Admin`
  - `GET /api/v1/ml/models`, `POST /api/v1/ml/models/{id}/promote`
  - Mỗi lần train ghi experiment vào MLflow. Liệt kê phiên bản kèm thời gian train, siêu tham số, chỉ số. Đánh dấu bản **production** (mỗi SKU/nhóm một bản).

---

## Phase 2 — Forecast Explorer (Module D)

> Tạo bảng `forecasts` ở T05: sku, store, ngày, horizon, p10/p50/p90, model_version. Các task sau dùng lại.

- [x] **T05 · UC17 — View Demand Forecast** · cả 3 role
  - `GET /api/v1/forecasts` · dự báo theo SKU từ model production.
- [x] **T06 · UC18 — Select Forecast Horizon** · cả 3 role
  - Tham số `horizon` ∈ {7, 14, 28}, mặc định theo cấu hình; giá trị khác trả 422.
- [x] **T07 · UC19 — Filter Forecast by SKU** · cả 3 role
  - Lọc theo SKU, ngành hàng (`category`), cửa hàng (`store_id`); phân trang, sắp xếp.
- [x] **T08 · UC20 — View Historical Demand** · cả 3 role
  - `GET /api/v1/forecasts/{sku}/history` · lấy từ dữ liệu bán hàng (UC15), tách khỏi dự báo, gộp ngày/tuần/tháng.
- [x] **T09 · UC21 — Compare Actual vs Predicted** · cả 3 role
  - `GET /api/v1/forecasts/{sku}/compare` · chuỗi thực tế và dự báo trên cùng khung thời gian (chỉ phần đã có thực tế).
- [x] **T10 · UC22 — View Prediction Uncertainty Band** · cả 3 role
  - Trả khoảng tin cậy **p10 / p50 / p90** và phân bố sai số cho một SKU.
- [x] **T11 · UC23 — View Forecast Explanation (SHAP)** · `Warehouse Manager`, `Admin` (**Viewer 403**)
  - Mức đóng góp của feature (giá, sự kiện, thời điểm). Tính SHAP lúc chạy dự báo và lưu, không tính lại mỗi request. Mô hình không có SHAP (ARIMA) trả 404 kèm thông báo rõ.
- [x] **T12 · UC24 — Manual Forecast Override** · `Warehouse Manager`, `Admin`
  - `POST /api/v1/forecasts/{sku}/override`, `DELETE /api/v1/forecasts/{sku}/override/{id}`
  - **Bắt buộc lý do**. Lưu giá trị gốc + giá trị override, người sửa, thời gian. Response nói rõ đang dùng giá trị nào. Hoàn tác được. Ghi audit.

---

## Phase 3 — Phân loại ABC/XYZ (Module E)

- [x] **T13 · UC25 — Configure ABC/XYZ Thresholds** · `Admin`
  - `GET/PUT /api/v1/classification/thresholds`
  - Mặc định: Pareto doanh thu **A 80% / B 15% / C 5%**; hệ số biến động CV = σ/μ: **X ≤ 0.5, Y 0.5–1.0, Z > 1.0**.
  - Đổi ngưỡng thì **tính lại phân loại toàn bộ SKU** (chạy nền nếu nhiều SKU).
- [x] **T14 · UC26 — View ABC-XYZ Matrix** · cả 3 role
  - `GET /api/v1/classification/matrix` · ma trận 3×3 (AX…CZ), mỗi ô có số lượng và tỷ trọng SKU.
- [x] **T15 · UC27 — Filter SKU by Segment** · cả 3 role
  - `GET /api/v1/classification/skus?abc=&xyz=` · phân trang, tìm kiếm.
- [x] **T16 · UC28 — Classification-based Recommendation** · `Warehouse Manager`, `Admin` (**Viewer 403**)
  - `GET /api/v1/classification/recommendations/{segment}`
  - Chính sách cho từng nhóm (ví dụ AX kiểm soát gắt gao theo ngày; CZ gom đơn định kỳ). Bảng luật 9 ô để ở config/seed, không hardcode rải rác.

---

## Phase 4 — Tối ưu tồn kho (Module F)

- [x] **T17 · UC29 — Configure Target Service Level** · `Admin`
  - `GET/PUT /api/v1/optimization/service-level`
  - τ ∈ **[0.85, 0.99]**, đặt theo nhóm hàng hoặc SKU. Đổi τ thì tính lại SS/ROP.
- [x] **T18 · UC30 — View Safety Stock / ROP / EOQ** · `Warehouse Manager`, `Admin`
  - `GET /api/v1/optimization/parameters`, `POST /api/v1/optimization/recompute`
  - `SS = Z_τ · σ_L` với `σ_L = σ_sai-số-ngày · √L`
  - `ROP = d_L + SS` (`d_L` = nhu cầu dự báo trong lead time)
  - `EOQ = √(2·D·S / H)`
  - Lưu vào bảng `inventory_params` để Dashboard và Replenishment dùng lại.
  - **Fallback:** chưa có model production thì tính bằng trung bình di động và gắn cờ `source: "static"` (có model thì `"ml"`). Nhờ vậy Phase 4–6 không bị kẹt chờ ML.
- [x] **T19 · UC31 — Compare ML vs Static Formula** · `Admin`
  - `GET /api/v1/optimization/compare-static` · song song ML và Moving Average, trả chênh lệch từng SKU.
- [x] **T20 · UC32 — Run Cost Sensitivity Analysis** · `Admin`
  - `POST /api/v1/optimization/sensitivity-analysis`
  - Mô phỏng Lead Time **±20%** hoặc Service Level **±5%**, ước tính tác động lên chi phí lưu kho và chi phí thiếu hàng. **Chỉ mô phỏng, không ghi đè dữ liệu thật.**

---

## Phase 5 — Nhập hàng (Module G)

> Bảng `replenishment_recommendations`: trạng thái `PENDING → APPROVED | REJECTED | CANCELLED`, số lượng đề xuất, số lượng điều chỉnh, lý do, người xử lý, thời gian.

- [ ] **T21 · UC33 — View Replenishment Recommendation List** · `Warehouse Manager`, `Admin`
  - `GET /api/v1/replenishments` · sinh đề xuất khi `On_hand + On_order ≤ ROP`, số lượng = EOQ, có mức ưu tiên. Không sinh trùng đề xuất đang `PENDING` cho cùng SKU/cửa hàng.
- [ ] **T22 · UC34 — Adjust Recommended Order Quantity** · `Warehouse Manager`, `Admin`
  - `PUT /api/v1/replenishments/{id}/adjust` · tự làm tròn theo MOQ/pack-size, bắt buộc lý do, chỉ sửa khi `PENDING`.
- [ ] **T23 · UC35 — Approve Replenishment** · `Warehouse Manager`, `Admin`
  - `POST /api/v1/replenishments/{id}/approve` · `PENDING → APPROVED`, **tăng `on_order`** tương ứng. Gọi qua service tồn kho hiện có để nhật ký kiểm kê và SSE `inventory.updated` vẫn chạy. Không duyệt lần hai.
- [ ] **T24 · UC36 — Reject / Cancel** · `Warehouse Manager`, `Admin`
  - `POST /api/v1/replenishments/{id}/reject` · bắt buộc lý do. `APPROVED` rồi thì không cho reject; hủy theo luồng riêng và **trả lại `on_order`**.
- [ ] **T25 · UC37 — View Replenishment History** · `Viewer`, `Warehouse Manager`, `Admin`
  - `GET /api/v1/replenishments/history` · lọc theo thời gian/SKU/trạng thái. **Viewer phải gọi được dù không gọi được T21**, đặt route trước `/{id}` để khỏi bị bắt nhầm.
- [ ] **T26 · UC38 — Export Replenishment List** · `Warehouse Manager`, `Admin`
  - `GET /api/v1/replenishments/export` · CSV/Excel, có bộ lọc.

---

## Phase 6 — Dashboard & Alerts (Module B)

- [ ] **T27 · UC07 — View Executive Dashboard** · cả 3 role
  - `GET /api/v1/dashboard/kpis`
  - Giá trị tồn kho = Σ(On_hand × Unit_Price); Stockout rate = số SKU hết hàng / tổng SKU; Service level ước tính. Cache ngắn hạn.
- [ ] **T28 · UC08 — View Demand Trend Chart** · cả 3 role
  - `GET /api/v1/dashboard/demand-trend` · theo ngày/tuần/tháng, lọc `store_id`, `category`.
- [ ] **T29 · UC09 — Stockout / Threshold Alert Panel** · cả 3 role
  - `GET /api/v1/dashboard/alerts` · traffic-light: 🔴 tồn ≤ SS · 🟡 SS < tồn ≤ ROP · 🟢 tồn > ROP. Phân trang, sắp xếp theo độ khẩn cấp.
- [ ] **T30 · UC10 — Receive Real-time Stock Alert** · `Warehouse Manager`, `Admin` (Viewer không nhận)
  - Phát `stock.alert` qua SSE `GET /api/v1/events` (đã có) khi SKU tụt dưới ROP sau kiểm kê hoặc bán hàng; có thể kèm email. **Chống spam:** mỗi SKU chỉ báo một lần cho mỗi đợt xuống dưới ROP, báo lại khi đã hồi phục rồi tụt lần nữa.

---

## Phase 7 — Báo cáo (Module H)

- [ ] **T31 · UC39 — Forecast Accuracy Report** · cả 3 role · MAE, RMSE, MASE, WRMSSE theo SKU/nhóm ABC, chọn mô hình + khoảng thời gian.
- [ ] **T32 · UC40 — Inventory Report** · cả 3 role · Turnover và Days of Supply.
- [ ] **T33 · UC41 — Run Historical Backtesting** · `Admin` · rolling origin trên dữ liệu quá khứ, mô phỏng tồn kho/stockout nếu áp dụng ML. Bất đồng bộ như T03.
- [ ] **T34 · UC42 — Cost Comparison Report** · `Admin` · chi phí ML vs Baseline kèm % cải thiện, tận dụng kết quả T19 và T33.
- [ ] **T35 · UC43 — Export Report** · cả 3 role · PDF/Excel, dùng chung cho T31–T34.

---

## Phase 8 — Tự động hóa

- [ ] **T36 · UC49 — Schedule Automated Batch Forecast** · `Admin`
  - Đặt tần suất/giờ chạy (cron), bật/tắt, xem lần chạy gần nhất. Dùng scheduler đã chọn cho dự án, **không chạy chồng** hai lần.
- [ ] **T37 · UC50 — Auto-compute SS/ROP/EOQ & ABC-XYZ sau Forecast Run** · hệ thống (không có màn hình)
  - Sau mỗi lần chạy dự báo theo lịch (T36): tính lại SS/ROP/EOQ (T18) rồi ABC-XYZ (T13) cho toàn bộ SKU. Một bước lỗi thì ghi log, các bước không phụ thuộc vẫn chạy. Ghi audit mỗi lần chạy.

---

## Thứ tự tóm tắt

| Phase | Task | UC |
|:--:|---|---|
| 0 | T01 | UC44 |
| 1 | T02–T04 | UC46, 47, 48 |
| 2 | T05–T12 | UC17–24 |
| 3 | T13–T16 | UC25–28 |
| 4 | T17–T20 | UC29–32 |
| 5 | T21–T26 | UC33–38 |
| 6 | T27–T30 | UC07–10 |
| 7 | T31–T35 | UC39–43 |
| 8 | T36–T37 | UC49, 50 |

Tổng: **37 task**, mỗi task một UC.
