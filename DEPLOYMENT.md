# Deployment Guide

This guide covers five deployment options, from simplest to most production-ready.

## Table of Contents

1. [Option 1: Bare Metal](#option-1-bare-metal)
2. [Option 2: Docker / Docker Compose](#option-2-docker--docker-compose)
3. [Option 3: Google Cloud Run](#option-3-google-cloud-run)
4. [Option 4: Azure Container Apps](#option-4-azure-container-apps)
5. [Option 5: Other Cloud Platforms](#option-5-other-cloud-platforms)
6. [Cloudflare Protection](#cloudflare-protection)
7. [Environment Variables](#environment-variables)
8. [Backup & Restore](#backup--restore)
9. [Monitoring & Troubleshooting](#monitoring--troubleshooting)

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

This is the production deployment used at ministry.hunterisadonkey.com. It uses GCS FUSE to mount a Cloud Storage bucket for persistent SQLite storage.

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

## Option 4: Azure Container Apps

This is the recommended Azure deployment for this app. It uses Azure Files mounted into Azure Container Apps for persistent SQLite storage.

### Architecture

```
Internet -> Cloudflare -> Azure Container Apps (1+ replicas)
                                                                     |
                                                            /data mount
                                                                     |
                                                    Azure Files share
                                                         (minister.db)
```

### Critical Configuration Notes

Before deploying, understand these requirements:

| Setting | Value | Why |
|---------|-------|-----|
| Replica baseline | **Min 1** | Reduces cold starts and storage mount timing issues. |
| Gunicorn workers | **1** | Multiple workers can corrupt SQLite behavior on shared network storage. |
| SQLite journal mode | `DELETE` | WAL mode sidecar files are fragile on network filesystems. |
| Persistent volume mount | `/data` | App defaults to `/data/minister.db`. |

### Step 1: Prerequisites

- Azure CLI 2.58+
- Docker 24+
- A Cloudflare-managed domain (already proxied)

Install Container Apps extension and providers:

```bash
az extension add --name containerapp --upgrade
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights
```

### Step 2: Set Variables

```bash
export LOCATION=eastus
export RESOURCE_GROUP=rg-minister-prod
export ACA_ENV=acae-minister-prod
export ACR_NAME=acrministerprod
export APP_NAME=minister-management
export STORAGE_NAME=stministerprod
export FILE_SHARE=minister-data
export STORAGE_MOUNT_NAME=minister-storage
export DB_PATH=/data/minister.db

# Optional custom hostname you will proxy with Cloudflare
export APP_HOST=minister.yourdomain.com
```

> Storage account and ACR names must be globally unique and lowercase.

### Step 3: Create Resource Group, Registry, and Environment

```bash
az group create --name $RESOURCE_GROUP --location $LOCATION

az acr create \
    --name $ACR_NAME \
    --resource-group $RESOURCE_GROUP \
    --location $LOCATION \
    --sku Basic

az containerapp env create \
    --name $ACA_ENV \
    --resource-group $RESOURCE_GROUP \
    --location $LOCATION
```

### Step 4: Build and Push Image

```bash
ACR_LOGIN_SERVER=$(az acr show --name $ACR_NAME --query loginServer -o tsv)
IMAGE=$ACR_LOGIN_SERVER/minister-management:$(date +%Y%m%d-%H%M)

az acr login --name $ACR_NAME
docker build -t $IMAGE .
docker push $IMAGE
```

### Step 5: Create Azure Files Storage

```bash
az storage account create \
    --name $STORAGE_NAME \
    --resource-group $RESOURCE_GROUP \
    --location $LOCATION \
    --sku Standard_LRS \
    --kind StorageV2

STORAGE_KEY=$(az storage account keys list \
    --resource-group $RESOURCE_GROUP \
    --account-name $STORAGE_NAME \
    --query "[0].value" -o tsv)

az storage share-rm create \
    --resource-group $RESOURCE_GROUP \
    --storage-account $STORAGE_NAME \
    --name $FILE_SHARE \
    --quota 20  # Size in GiB
```

### Step 6: Register Storage with Container Apps Environment

```bash
az containerapp env storage set \
    --name $ACA_ENV \
    --resource-group $RESOURCE_GROUP \
    --storage-name $STORAGE_MOUNT_NAME \
    --azure-file-account-name $STORAGE_NAME \
    --azure-file-account-key "$STORAGE_KEY" \
    --azure-file-share-name $FILE_SHARE \
    --access-mode ReadWrite
```

### Step 7: Create the Container App

Generate secrets safely:

```bash
export SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")
export ADMIN_PASSWORD='change-me-admin'
export MINISTER_PASSWORD='change-me-minister'

ACR_USERNAME=$(az acr credential show \
    --name $ACR_NAME \
    --resource-group $RESOURCE_GROUP \
    --query username -o tsv)

ACR_PASSWORD=$(az acr credential show \
    --name $ACR_NAME \
    --resource-group $RESOURCE_GROUP \
    --query "passwords[0].value" -o tsv)
```

Create app with ingress, storage mount, secrets, and SQLite-safe scaling:

```bash
az containerapp create \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --environment $ACA_ENV \
    --image $IMAGE \
    --registry-server $ACR_LOGIN_SERVER \
    --registry-username "$ACR_USERNAME" \
    --registry-password "$ACR_PASSWORD" \
    --target-port 8080 \
    --ingress external \
    --min-replicas 1 \
    --max-replicas 2 \
    --cpu 0.5 \
    --memory 1.0Gi \
    --secrets "secret-key=$SECRET_KEY" "admin-password=$ADMIN_PASSWORD" "minister-password=$MINISTER_PASSWORD" \
    --env-vars "FLASK_ENV=production" "DATABASE_PATH=$DB_PATH" "PORT=8080" "SECRET_KEY=secretref:secret-key" "ADMIN_PASSWORD=secretref:admin-password" "MINISTER_PASSWORD=secretref:minister-password" \
    --storage-mounts "mountPath=/data,storageName=$STORAGE_MOUNT_NAME"
```

### Step 8: Validate Deployment

```bash
APP_FQDN=$(az containerapp show \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --query properties.configuration.ingress.fqdn -o tsv)

curl https://$APP_FQDN/health
```

Expected response:

```json
{"status":"healthy"}
```

### Step 9: Configure Custom Domain in Azure

Add and validate custom domain (Cloudflare DNS records required):

```bash
az containerapp hostname add \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --hostname $APP_HOST
```

Use the validation details from the command output to create required DNS records in Cloudflare.

Then create/bind certificate in Azure using the Azure Portal (Container App -> Custom domains) or the latest supported CLI commands for your CLI version.

Use this command to verify domain binding status:

```bash
az containerapp hostname list \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP
```

### Updating

```bash
# Build/push a new image tag
IMAGE=$ACR_LOGIN_SERVER/minister-management:$(date +%Y%m%d-%H%M)
docker build -t $IMAGE .
docker push $IMAGE

# Point app to the new image
az containerapp update \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --image $IMAGE
```

---

## Option 5: Other Cloud Platforms

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

## Cloudflare Protection

This section assumes your DNS is already hosted in Cloudflare and your app is running in Azure Container Apps.

### Step 1: DNS and Proxy

1. In Cloudflare DNS, create `CNAME` for your app hostname to the Azure Container Apps FQDN.
2. Keep Proxy status set to **Proxied** (orange cloud).
3. Set low TTL during first rollout.

### Step 2: SSL/TLS

In Cloudflare SSL/TLS settings:

1. Set mode to **Full (strict)**.
2. Enable **Always Use HTTPS**.
3. Enable **Automatic HTTPS Rewrites**.
4. Keep minimum TLS at 1.2 or higher.

### Step 3: WAF Managed Rules

In Security -> WAF:

1. Enable Cloudflare Managed Ruleset.
2. Start in Log mode for 15-30 minutes if this is your first deployment.
3. Switch to Block mode after validating no false positives on player form submissions.

### Step 4: Rate Limiting Rules

Create baseline rules:

1. Path contains `/api/admin/login`: challenge or block after 10 requests/minute per IP.
2. Path starts with `/api/admin/`: challenge after 60 requests/minute per IP.
3. Path starts with `/api/`: throttle at 180 requests/minute per IP.

These are safe starter values. Tune using real traffic patterns.

### Step 5: Cache Rules

1. Cache static asset paths (`/assets/*`) with standard cache behavior.
2. Bypass cache for `/api/*`, `/health`, and authenticated/admin paths.

### Step 6: Admin Hardening (Recommended)

For stronger protection, add an extra challenge on admin UI and API paths:

1. Path starts with `/admin` -> Managed Challenge.
2. Path starts with `/api/admin` -> Managed Challenge.

Optional follow-up: add Cloudflare Access policy for `/admin*` and `/api/admin*` so only approved identities can reach admin pages.

### Step 7: Validate Through Cloudflare

```bash
curl -I https://$APP_HOST/
curl https://$APP_HOST/health
```

Check that:

- Health endpoint responds successfully.
- TLS certificate is valid.
- Requests include Cloudflare headers (for example, `cf-ray`).
- API responses are not cached.

---

## Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `FLASK_ENV` | `development` or `production` | `production` | No |
| `SECRET_KEY` | Flask session secret key | `dev-secret-key` | Yes (production) |
| `ADMIN_PASSWORD` | Admin login password | `admin123` | Yes |
| `MINISTER_PASSWORD` | Minister login password | `minister123` | Yes |
| `DATABASE_PATH` | Path to SQLite database file | `/data/minister.db` | Yes |
| `PORT` | Server port | `8080` | No |

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

### Azure Files

```bash
# Backup from Azure Files to local
az storage file download \
    --account-name $STORAGE_NAME \
    --account-key "$STORAGE_KEY" \
    --share-name $FILE_SHARE \
    --path minister.db \
    --dest ./backups/minister_$(date +%Y%m%d).db

# Restore from local to Azure Files
az storage file upload \
    --account-name $STORAGE_NAME \
    --account-key "$STORAGE_KEY" \
    --share-name $FILE_SHARE \
    --source ./backups/minister_20260306.db \
    --path minister.db
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

# Azure Container Apps
az containerapp logs show \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --follow

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

**Azure Container Apps database errors:**
- Ensure Azure Files is mounted at `/data` and `DATABASE_PATH=/data/minister.db`
- Keep single-worker gunicorn (already set in Dockerfile)
- If database becomes corrupt, restore from backup and restart the app revision

**Cloudflare blocks valid traffic:**
- Switch new WAF/rate-limit rules to Log or Challenge mode first
- Exclude trusted admin IPs temporarily while tuning
- Verify `/api/*` routes are not accidentally cached
