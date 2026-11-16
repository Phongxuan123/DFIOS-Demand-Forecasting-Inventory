FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
# Q-10: uvicorn must NOT rewrite request.client from a client-supplied X-Forwarded-For. The app honours the header
# itself only for peers listed in TRUSTED_PROXIES (app/api/deps.py:get_client_ip).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"]
