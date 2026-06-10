# Deployment Guide

This guide covers four deployment options, from simplest to most production-ready.

## Table of Contents

1. [Option 1: Bare Metal](#option-1-bare-metal)
2. [Option 2: Docker / Docker Compose](#option-2-docker--docker-compose)
3. [Option 3: Google Cloud Run](#option-3-google-cloud-run)
4. [Option 4: Other Cloud Platforms](#option-4-other-cloud-platforms)
5. [Environment Variables](#environment-variables)
6. [Backup & Restore](#backup--restore)
7. [Monitoring & Troubleshooting](#monitoring--troubleshooting)

---

## Option 1: Bare Metal

Run directly on any Linux, macOS, or Windows server without Docker.

### Prerequisites

- Python 3.11+
- Node.js 18+ (needed only at build time, not runtime)
- A server or VM with persistent storage

### Step 1: Build the Frontend

```bash
cd frontend
npm ci
npm run build
# Creates frontend/dist/ with the production build
```

### Step 2: Set Up the Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Step 3: Copy Built Frontend

```bash
# From the project root
cp -r frontend/dist backend/static
```

The Flask app serves the built frontend from its `static/` folder.

### Step 4: Configure Environment

Create `backend/.env`:

```env
FLASK_ENV=production
SECRET_KEY=your-random-secret-key-here
ADMIN_PASSWORD=your-admin-password
MINISTER_PASSWORD=your-minister-password
DATABASE_PATH=/var/lib/minister/minister.db
PORT=8080
```

Generate a secret key:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Ensure the database directory exists and is writable:
```bash
sudo mkdir -p /var/lib/minister
sudo chown $(whoami) /var/lib/minister
```

### Step 5: Run with Gunicorn

```bash
cd backend
source venv/bin/activate
gunicorn --bind 0.0.0.0:8080 --workers 1 --threads 2 --timeout 120 app:app
```

> **Important:** Use `--workers 1`. SQLite does not handle concurrent writers well. A single worker with multiple threads is the safe configuration.

### Step 6: systemd Service (Optional)

Create `/etc/systemd/system/minister.service`:

```ini
[Unit]
Description=Ministry Management System
After=network.target

[Service]
Type=simple
User=minister
WorkingDirectory=/opt/minister/backend
EnvironmentFile=/opt/minister/backend/.env
ExecStart=/opt/minister/backend/venv/bin/gunicorn \
    --bind 0.0.0.0:8080 \
    --workers 1 \
    --threads 2 \
    --timeout 120 \
    app:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable minister
sudo systemctl start minister
```

### Step 7: Reverse Proxy (Optional)

#### Nginx

```nginx
server {
    listen 80;
    server_name minister.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name minister.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/minister.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/minister.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### Caddy (simpler, auto-HTTPS)

```
minister.yourdomain.com {
    reverse_proxy localhost:8080
}
```

---

## Option 2: Docker / Docker Compose

### Quick Start with Docker Compose

```bash
cp .env.example .env
# Edit .env with your passwords
docker compose up --build
# Open http://localhost:8080
```

Data persists in the `./data/` directory on your host machine.

### Manual Docker Build & Run

```bash
# Build the image
docker build -t minister-management .

# Run the container
docker run -d \
    -p 8080:8080 \
    -v $(pwd)/data:/data \
    -e FLASK_ENV=production \
    -e SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))") \
    -e ADMIN_PASSWORD=your-password \
    -e MINISTER_PASSWORD=your-password \
    --name minister \
    minister-management
```

### Volume Path Note

The Dockerfile sets `DATABASE_PATH=/data/minister.db` by default. The `docker-compose.yml` overrides this to `/app/data/minister.db` and mounts `./data:/app/data`. Both work correctly:

- **docker-compose:** mounts `./data` to `/app/data`, uses `DATABASE_PATH=/app/data/minister.db`
- **docker run:** mount `./data` to `/data` to match the Dockerfile default

### Updating

```bash
docker compose down
docker compose up --build
```

### Useful Commands

```bash
docker compose logs -f          # Follow logs
docker compose restart          # Restart without rebuilding
docker compose down -v          # Stop and remove volumes (data loss!)
```

---

## Option 3: Google Cloud Run

This is a production-grade deployment pattern (similar to what the reference deployment at `<your-domain.example.com>` uses — substitute your own custom domain). It uses GCS FUSE to mount a Cloud Storage bucket for persistent SQLite storage.

### Architecture

```
Internet → Cloud Run (gen2) → Flask/gunicorn (1 worker)
                                    ↕
                              GCS FUSE mount (/data)
                                    ↕
                              Cloud Storage bucket (minister.db)
```

### Critical Configuration Notes

Before deploying, understand these requirements:

| Setting | Value | Why |
|---------|-------|-----|
| `--min-instances 1` | **Required** | Without this, Cloud Run scales to zero aggressively. Cold starts cause crash loops as GCS FUSE races with gunicorn startup. |
| `--execution-environment gen2` | **Required** | Gen2 is needed for GCS FUSE volume mounts. |
| `--workers 1` | **Required** | Multiple gunicorn workers cause concurrent SQLite writes, producing `OutOfOrderError` on GCS FUSE. |
| `journal_mode=DELETE` | Set in code | WAL mode creates `-shm` and `-wal` sidecar files that are incompatible with GCS FUSE (out-of-order write errors). This is already configured in `database.py`. |

### Step 1: Project Setup

```bash
export PROJECT_ID=your-project-id
gcloud config set project $PROJECT_ID

gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable storage.googleapis.com
gcloud services enable secretmanager.googleapis.com
```

### Step 2: Create GCS Bucket

```bash
export BUCKET_NAME=your-minister-data-bucket
gsutil mb -l us-central1 gs://$BUCKET_NAME
```

Do **not** make this bucket public. It contains your database.

### Step 3: Create Secrets

```bash
echo -n "your-admin-password" | gcloud secrets create admin-password --data-file=-
echo -n "your-minister-password" | gcloud secrets create minister-password --data-file=-
echo -n "$(python -c 'import secrets; print(secrets.token_hex(32))')" | gcloud secrets create minister-secret-key --data-file=-
```

Grant the Cloud Run service account access:

```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")

for SECRET in admin-password minister-password minister-secret-key; do
    gcloud secrets add-iam-policy-binding $SECRET \
        --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
        --role="roles/secretmanager.secretAccessor"
done
```

### Step 4: Build the Image

```bash
gcloud builds submit --tag gcr.io/$PROJECT_ID/minister-management
```

### Step 5: Deploy

```bash
gcloud run deploy minister-management \
    --image gcr.io/$PROJECT_ID/minister-management \
    --platform managed \
    --region us-central1 \
    --execution-environment gen2 \
    --allow-unauthenticated \
    --memory 512Mi \
    --cpu 1 \
    --timeout 300 \
    --min-instances 1 \
    --max-instances 3 \
    --set-env-vars "FLASK_ENV=production,DATABASE_PATH=/data/minister.db" \
    --set-secrets "SECRET_KEY=minister-secret-key:latest,ADMIN_PASSWORD=admin-password:latest,MINISTER_PASSWORD=minister-password:latest" \
    --add-volume name=data,type=cloud-storage,bucket=$BUCKET_NAME \
    --add-volume-mount volume=data,mount-path=/data
```

### Step 6: Custom Domain (Optional)

```bash
gcloud run domain-mappings create \
    --service minister-management \
    --domain your-domain.com \
    --region us-central1
```

Follow the DNS instructions provided (typically a CNAME to `ghs.googlehosted.com`).

### Updating

```bash
gcloud builds submit --tag gcr.io/$PROJECT_ID/minister-management
gcloud run deploy minister-management \
    --image gcr.io/$PROJECT_ID/minister-management \
    --region us-central1
```

---

## Option 4: Other Cloud Platforms

The app runs anywhere that supports Docker and persistent filesystem storage for SQLite.

### General Requirements

1. Build the Docker image (or deploy bare metal)
2. Mount persistent storage at the `DATABASE_PATH` location
3. Set environment variables (see [Environment Variables](#environment-variables))
4. Use a single gunicorn worker (`--workers 1`) for SQLite
5. On network filesystems, ensure `journal_mode=DELETE` (already set in code)

### AWS

- **ECS/Fargate** - Use the Dockerfile. Mount an EFS volume for persistent SQLite storage.
- **Elastic Beanstalk** - Docker platform. Use EBS for storage.
- **EC2** - Follow the [Bare Metal](#option-1-bare-metal) instructions.

### Azure

- **Container Apps** - Similar to Cloud Run. Mount Azure Files for persistence.
- **App Service** - Docker container deployment with persistent storage.

### DigitalOcean

- **App Platform** - Docker deployment with managed volumes.
- **Droplet** - Follow the [Bare Metal](#option-1-bare-metal) instructions.

### PaaS (Railway, Render, Fly.io)

- **Fly.io** - Docker deployment with persistent volumes. Good fit for SQLite.
- **Railway** - Docker deployment. Check persistent disk availability.
- **Render** - Docker deployment with persistent disk option.

> **Key consideration:** SQLite requires a persistent filesystem. Ephemeral container storage will lose data on restart. Always verify your platform provides persistent disk mounts.

---

## Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `FLASK_ENV` | `development` or `production` | `production` | No |
| `SECRET_KEY` | Flask session secret key | `dev-secret-key` | Yes (production) |
| `ADMIN_PASSWORD` | Admin login password | `admin123` ⚠️ **change before any non-trivial deployment** | Yes |
| `MINISTER_PASSWORD` | Minister login password | `minister123` ⚠️ **change before any non-trivial deployment** | Yes |
| `DATABASE_PATH` | Path to SQLite database file | `/data/minister.db` | Yes |
| `PORT` | Server port | `8080` | No |

> ⚠️ **Never deploy with the default passwords.** `admin123` and `minister123` exist only to make local quick-start work. Anyone with the admin password can edit/delete every player and publish or unpublish schedules. Always override them via `.env`, a secret store (Cloud Secret Manager, Key Vault, etc.), or environment variables before the app is reachable from outside your laptop.

---

## Backup & Restore

### Local / Bare Metal

```bash
# Backup
sqlite3 /path/to/minister.db ".backup '/path/to/backup/minister_$(date +%Y%m%d).db'"

# Restore
cp /path/to/backup/minister_20260306.db /path/to/minister.db
```

### Google Cloud Storage

```bash
# Backup from GCS
gsutil cp gs://$BUCKET_NAME/minister.db ./backups/minister_$(date +%Y%m%d).db

# Restore to GCS
gsutil cp ./backups/minister_20260306.db gs://$BUCKET_NAME/minister.db
```

### Docker

```bash
# Backup (data is in ./data/ on host)
cp ./data/minister.db ./backups/minister_$(date +%Y%m%d).db

# Restore
cp ./backups/minister_20260306.db ./data/minister.db
docker compose restart
```

---

## Monitoring & Troubleshooting

### Health Check

```bash
curl http://localhost:8080/health
# Returns: {"status": "healthy"}
```

### Logs

```bash
# Docker
docker compose logs -f

# Cloud Run
gcloud run services logs read minister-management --region=us-central1

# systemd
journalctl -u minister -f
```

### Common Issues

**Application won't start:**
- Check `.env` file exists and `DATABASE_PATH` directory is writable
- Verify Python venv is activated (bare metal)
- Check port is not in use: `lsof -i :8080`

**Database not persisting (Docker):**
- Ensure volume is mounted: check `docker compose logs` for path errors
- Verify `./data/` directory exists on host

**Cloud Run crash loop (429 errors):**
- Set `--min-instances 1` to prevent aggressive cold-start scaling
- Check logs: `gcloud run services logs read minister-management`
- Verify GCS FUSE volume mount is configured

**Cloud Run database errors:**
- Ensure `--workers 1` in gunicorn CMD (multiple workers break SQLite on GCS FUSE)
- Verify `journal_mode=DELETE` is set (check `database.py`)
- If you see `OutOfOrderError`, delete the database from the GCS bucket and let it recreate
