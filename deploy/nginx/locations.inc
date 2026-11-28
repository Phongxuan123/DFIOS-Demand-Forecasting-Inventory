# Shared by default.conf (HTTP) and https.conf (HTTPS): the two routes of the DFIOS entry point.
#   /api/...  -> backend (FastAPI, port 8000); SSE streams are not buffered
#   /         -> frontend (Vite dev server, port 5173; websocket upgrade for HMR)

location /api/ {
    proxy_pass http://dfios_api;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;   # overwrite, never append a client-supplied value
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_buffering off;           # server-sent events (/api/v1/events)
    proxy_read_timeout 600s;       # synchronous advances / reports can take minutes
}

location / {
    proxy_pass http://dfios_web;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
}
