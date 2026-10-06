# DFIOS-Demand-Forecasting-Inventory
Hệ thống dự báo nhu cầu & tối ưu tồn kho bằng Machine Learning - Đồ án tốt nghiệp

---

## Cấu hình Email SMTP & Xác thực Email (Backend)

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

