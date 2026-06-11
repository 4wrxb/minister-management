# Deployment Guide

This guide covers several deployment options, from simplest to most production-ready, plus a platform-agnostic guide for fronting any of them with Cloudflare.

## Table of Contents

1. [Option 1: Bare Metal](#option-1-bare-metal)
2. [Option 2: Docker / Docker Compose](#option-2-docker--docker-compose)
3. [Option 3: Google Cloud Run](#option-3-google-cloud-run)
4. [Option 4: Azure App Service + Cloudflare Tunnel sidecar](#option-4-azure-app-service--cloudflare-tunnel-sidecar)
5. [Option 5: Azure Container Apps (Automated)](#option-5-azure-container-apps-automated)
6. [Option 6: Other Cloud Platforms](#option-6-other-cloud-platforms)
7. [Putting Cloudflare in Front of Any Deployment](#putting-cloudflare-in-front-of-any-deployment)
8. [Environment Variables](#environment-variables)
9. [Backup & Restore](#backup--restore)
10. [Monitoring & Troubleshooting](#monitoring--troubleshooting)

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

## Option 4: Azure App Service + Cloudflare Tunnel sidecar

This option runs the app on Azure App Service for Linux as a **multi-container** site, with persistent SQLite storage on Azure Files (SMB) and a `cloudflared` sidecar that publishes the site through a Cloudflare Tunnel. The App Service itself stays private and only accepts traffic from Cloudflare's IP ranges, so the public URL is `https://<your-domain>` served by Cloudflare with no exposed origin.

### Architecture

```
Internet ── Cloudflare edge (DNS + TLS + WAF)
                │
                └── Cloudflare Tunnel ──► cloudflared sidecar (App Service)
                                                │
                                                └── http://localhost:8080
                                                          │
                                                    Flask/gunicorn
                                                          │
                                                    /data (Azure Files / SMB)
                                                          │
                                                    minister.db
```

Why this shape:

- **App Service multi-container** lets the Flask app and `cloudflared` run together in one Web App, sharing `localhost` so the tunnel can reach gunicorn over the loopback.
- **Azure Files (SMB)** gives persistent storage that survives App Service restarts and scale-out. SMB does *not* honour POSIX `fcntl` byte-range locks reliably, so SQLite must use the `unix-dotfile` VFS (`SQLITE_VFS=unix-dotfile`) and stay on `journal_mode=DELETE`.
- **Cloudflare Tunnel** removes the need for inbound public ingress; combined with the App Service `ipSecurityRestrictions` allowlist for the `AzureFrontDoor.Backend`/Cloudflare IPs, the origin is effectively zero-trust.

### Prerequisites

- Azure subscription and the `az` CLI (logged in via `az login`)
- A container registry the App Service can pull from (Azure Container Registry, Docker Hub, or GHCR). This guide uses Azure Container Registry (ACR).
- A Cloudflare account with the target domain on your Cloudflare DNS
- The `cloudflared` CLI installed locally (one-time, to create the tunnel)

### Step 1: Build and push the application image

The app's existing `Dockerfile` already produces a single image that serves both the Flask backend and the built React frontend on port 8080.

If you intend to host the app at the **root** of a hostname (e.g. `https://ministry.example.com/`), no Dockerfile change is needed:

```bash
az acr login --name <yourRegistry>
docker build -t <yourRegistry>.azurecr.io/minister-management:latest .
docker push   <yourRegistry>.azurecr.io/minister-management:latest
```

No special build flags are needed for sub-path hosting. The frontend bundle is built with `base: './'` so its asset URLs are relative; at request time, `backend/app.py` splices a `<base href="${URL_PREFIX}/">` tag into the served `index.html` so the same image works at any prefix. You'll set `URL_PREFIX=/ministry` on the running container in Step 5 and the Flask backend will mount itself at that prefix while keeping `/health` at the root for App Service / Cloudflare health probes.

### Step 2: Create the resource group, storage account, and file share

```bash
export RG=minister-rg
export LOC=eastus
export STORAGE=ministerstg$RANDOM        # must be globally unique, 3-24 lowercase
export SHARE=minister-data
export PLAN=minister-plan
export APP=minister-app

az group create -n $RG -l $LOC

az storage account create \
    -n $STORAGE -g $RG -l $LOC \
    --sku Standard_LRS --kind StorageV2

az storage share-rm create \
    --resource-group $RG \
    --storage-account $STORAGE \
    --name $SHARE \
    --quota 5
```

### Step 3: Create the App Service plan and Web App

A multi-container Web App requires a Linux plan on B1 or higher (the F1 free tier does not support multi-container or persistent storage).

```bash
az appservice plan create \
    -n $PLAN -g $RG -l $LOC \
    --is-linux --sku B1

# Create the Web App with a placeholder image; the real compose comes in step 5.
az webapp create \
    -g $RG --plan $PLAN -n $APP \
    --deployment-container-image-name nginx
```

Wire the storage account credential App Service needs to mount the share:

```bash
STORAGE_KEY=$(az storage account keys list \
    -g $RG --account-name $STORAGE --query "[0].value" -o tsv)

az webapp config storage-account add \
    -g $RG -n $APP \
    --custom-id ministerdata \
    --storage-type AzureFiles \
    --account-name $STORAGE \
    --share-name $SHARE \
    --access-key "$STORAGE_KEY" \
    --mount-path /data
```

This mounts the file share at `/data` inside every container in the Web App, which is where the app's `DATABASE_PATH` points by default.

### Step 4: Create the Cloudflare Tunnel

Run this once locally to create the tunnel and generate a credentials file.

```bash
cloudflared tunnel login                        # opens browser, picks zone
cloudflared tunnel create minister-tunnel
# Note the tunnel UUID printed; the credentials JSON is saved to
# ~/.cloudflared/<UUID>.json

# Route a hostname to the tunnel (creates the DNS CNAME in Cloudflare)
cloudflared tunnel route dns minister-tunnel ministry.example.com
```

You now have:

- A tunnel UUID
- `~/.cloudflared/<UUID>.json` containing `AccountTag`, `TunnelID`, `TunnelSecret`

Two pieces of config will be passed to the sidecar container:

1. The credentials JSON (mounted as a file via Azure Files, or pasted into the `TUNNEL_TOKEN` env var if you'd rather use a token-based tunnel — see Cloudflare's "Remote-managed tunnels" docs).
2. A small `config.yml` describing the ingress rules.

For App Service the simplest path is to use a **token-based tunnel**: in the Cloudflare Zero Trust dashboard, open the tunnel you just created, click **Configure → Token**, copy the value, and set it as the `TUNNEL_TOKEN` env var on the sidecar. With token mode you don't need a `config.yml` file at all — ingress rules are configured in the dashboard (`Public Hostname` tab) pointing at `http://localhost:8080` (or `http://localhost:8080/ministry` if you used a sub-path).

### Step 5: Deploy the multi-container compose

App Service multi-container takes a `docker-compose.yml` (a subset — only `image`, `ports`, `environment`, `volumes`, `restart` work). Save the following as `appservice-compose.yml`, substituting your registry name:

```yaml
version: "3.8"

services:
  app:
    image: <yourRegistry>.azurecr.io/minister-management:latest
    restart: unless-stopped
    volumes:
      - ${WEBAPP_STORAGE_ministerdata}:/data
    environment:
      - FLASK_ENV=production
      - DATABASE_PATH=/data/minister.db
      - SQLITE_VFS=unix-dotfile          # Required: Azure Files is SMB
      # Path-based hosting: set URL_PREFIX to the sub-path (no trailing slash),
      # omit it for root hosting. No rebuild needed — the backend injects a
      # <base href> tag at request time so the same image works at any prefix.
      - URL_PREFIX=/ministry
      - SECRET_KEY=${SECRET_KEY}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - MINISTER_PASSWORD=${MINISTER_PASSWORD}

  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN=${TUNNEL_TOKEN}
```

Notes:

- `${WEBAPP_STORAGE_ministerdata}` is the auto-injected mount reference produced by the storage binding you created in Step 3 (the suffix matches the `--custom-id` you used).
- All `${VAR}` placeholders read from App Service application settings, which you set next.
- Both containers share the App Service network namespace, so `cloudflared` reaches gunicorn at `http://localhost:8080`.
- Do **not** expose port 8080 publicly on the Web App; with the Cloudflare sidecar there's no need.

Apply the compose and the secrets:

```bash
# Give the Web App permission to pull from ACR (managed identity is simplest).
az webapp identity assign -g $RG -n $APP
PRINCIPAL=$(az webapp identity show -g $RG -n $APP --query principalId -o tsv)
ACR_ID=$(az acr show -n <yourRegistry> --query id -o tsv)
az role assignment create --assignee $PRINCIPAL --role AcrPull --scope $ACR_ID
az webapp config set -g $RG -n $APP --acr-use-identity --acr-identity [system]

# Push the compose
az webapp config container set \
    -g $RG -n $APP \
    --multicontainer-config-type COMPOSE \
    --multicontainer-config-file appservice-compose.yml

# Application settings (all of these are injected into both containers)
az webapp config appsettings set -g $RG -n $APP --settings \
    SECRET_KEY="$(python -c 'import secrets; print(secrets.token_hex(32))')" \
    ADMIN_PASSWORD="your-admin-password" \
    MINISTER_PASSWORD="your-minister-password" \
    TUNNEL_TOKEN="<paste the Cloudflare token from Step 4>" \
    WEBSITES_ENABLE_APP_SERVICE_STORAGE=false
```

`WEBSITES_ENABLE_APP_SERVICE_STORAGE=false` keeps App Service from layering its own `/home` storage in front of your mount.

Restart and tail the logs:

```bash
az webapp restart -g $RG -n $APP
az webapp log tail -g $RG -n $APP
```

You should see the `app` container start gunicorn on `0.0.0.0:8080` and the `cloudflared` container register the tunnel. The site is now reachable at `https://ministry.example.com` (or whatever hostname you routed in Step 4).

### Step 6: Lock the origin down to Cloudflare

Even though the sidecar tunnel means there is no public ingress on the Web App, App Service's default `*.azurewebsites.net` hostname is still reachable. Add an inbound IP allowlist that only accepts traffic from Cloudflare:

```bash
# Block everything by default, then allow Cloudflare's published IPv4 ranges.
# Pull the live list from https://www.cloudflare.com/ips-v4 and apply each /CIDR:
for cidr in $(curl -s https://www.cloudflare.com/ips-v4); do
    az webapp config access-restriction add \
        -g $RG -n $APP \
        --rule-name "cloudflare-$(echo $cidr | tr '/.' '-')" \
        --action Allow --priority 100 \
        --ip-address "$cidr"
done

# Do the same for IPv6 if your plan supports it:
for cidr in $(curl -s https://www.cloudflare.com/ips-v6); do
    az webapp config access-restriction add \
        -g $RG -n $APP \
        --rule-name "cloudflare6-$(echo $cidr | tr '/:.' '-')" \
        --action Allow --priority 100 \
        --ip-address "$cidr"
done
```

Verify that direct hits to `https://$APP.azurewebsites.net` now return `403 Forbidden` while `https://ministry.example.com` continues to work.

### Step 7 (optional): Path-based routing example

If you went with `URL_PREFIX=/ministry` in Step 5, configure the Cloudflare Tunnel **Public Hostname** to forward `example.com/ministry/*` to `http://localhost:8080`. The Flask app is mounted at `/ministry` via `DispatcherMiddleware`, so requests arrive correctly; `backend/app.py` splices `<base href="/ministry/">` into the served `index.html` at request time so React Router's `basename` and the bundle's relative asset URLs all resolve under the prefix without a rebuild. `https://example.com/health` is still served (at the root) for Cloudflare's health checks because the URL-prefix middleware keeps `/health` mounted at `/`.

### Updating

```bash
docker build -t <yourRegistry>.azurecr.io/minister-management:latest .
docker push   <yourRegistry>.azurecr.io/minister-management:latest
az webapp restart -g $RG -n $APP
```

### Troubleshooting

- **`OperationalError: database is locked` on startup:** confirm `SQLITE_VFS=unix-dotfile` is set and `journal_mode=DELETE` is in effect (already configured in `database.py`). Both are required on Azure Files.
- **`cloudflared` keeps reconnecting:** check `az webapp log tail` for `failed to register tunnel` — usually a stale `TUNNEL_TOKEN`. Re-copy from the Zero Trust dashboard.
- **`502 Bad Gateway` from Cloudflare:** the app container probably hasn't bound `0.0.0.0:8080` yet. Wait for the cold-start log line `Listening at: http://0.0.0.0:8080`.
- **Assets 404 under a sub-path:** `URL_PREFIX` is missing or set to a value that doesn't match the Cloudflare ingress path. Verify with `curl https://ministry.example.com/ministry/ | grep '<base href'` — it should print `<base href="/ministry/">`.
- **`403` from Cloudflare on the real domain:** an `ipSecurityRestrictions` rule is blocking the edge — recheck the IP list, particularly after Cloudflare publishes a new range.

---

## Option 5: Azure Container Apps (Automated)

This option deploys the app to **Azure Container Apps** using a **GitHub Actions workflow** with **Bicep infrastructure-as-code**, offering automated staging→production deployments, database backup/restore, and health-check-based rollback.

### Architecture

```
GitHub Actions Workflow (config-driven)
    ├─ Validate Bicep & run tests
    ├─ Build & push image to GHCR
    ├─ Bootstrap resources (if needed)
    ├─ Deploy to staging
    │   ├─ Backup database
    │   ├─ Deploy Container App
    │   ├─ Health check (5 min timeout)
    │   └─ E2E tests
    ├─ Manual approval gate
    └─ Deploy to production
        ├─ Backup database
        ├─ Deploy Container App
        ├─ Health check & auto-rollback
        └─ Post-deployment validation
```

This pattern is ideal for small-scale apps (<1000 users/day) that need:

- ✅ **Staged rollout** (staging → prod with approval)
- ✅ **Automated checks** (Bicep validation, test suite, E2E tests, health probes)
- ✅ **Database safety** (backup before each deploy, auto-rollback on failure)
- ✅ **Infrastructure as code** (repeatable, version-controlled deployments)
- ✅ **Zero-downtime updates** (managed identity, container probes, liveness/readiness)

### Prerequisites

- Azure subscription
- GitHub repository with Actions enabled
- `az` CLI (authenticated to Azure)
- Docker (for local image builds)

### Step 0: Make the GHCR package public (one-time)

The Container App pulls images **anonymously** from `ghcr.io`, so the package must be **public**. GitHub creates new container packages as private by default, so this is a one-time setup step:

1. **Trigger the workflow once** (see Step 3 below). The `build-image` job will push `ghcr.io/<your-owner>/minister-management:<sha>` and GitHub will auto-create the package. Because the `Dockerfile` sets `org.opencontainers.image.source`, the package is **auto-connected to this repo** and immediately surfaces on your repo's **Packages** tab.
2. The next job, `verify-package-visibility`, will **fail fast** with a clear error and a direct link to the package settings page — this is expected on the very first run.
3. Open that URL (typically `https://github.com/users/<owner>/packages/container/minister-management/settings` or `https://github.com/orgs/<owner>/...`), then either:
   - Click **Change visibility** → **Public** → confirm, *or*
   - Enable **Inherit access from source repository** in the package settings (works because the Dockerfile labels connect the package to the repo)
4. Re-run the workflow. From now on, `verify-package-visibility` passes in seconds and you never need to touch this setting again.

**Why public is safe here:** the image contains no secrets — no build-time `--build-arg`/`--mount=type=secret`, no `.env` files (excluded by `.dockerignore`), no `VITE_*` baked into the frontend bundle, and all runtime credentials (`SECRET_KEY`, `ADMIN_PASSWORD`, `MINISTER_PASSWORD`, etc.) flow into the Container App via the ACA `secrets` block, not into the image. See the full audit in [`.github/DEPLOYMENT_WORKFLOW.md`](.github/DEPLOYMENT_WORKFLOW.md#container-image-registry--visibility).

**Why this isn't automated:** flipping package visibility requires a PAT with `admin:packages` scope; the workflow's built-in `GITHUB_TOKEN` cannot do it. Storing a long-lived PAT just to click one bit once per repo is the wrong trade-off — the preflight check catches the mistake reliably and the operator UX is "one extra click on the first deploy ever."

### Step 1: Set Up Azure Service Principal

Create a service principal for GitHub Actions:

```bash
az ad sp create-for-rbac \
  --name "minister-deployment" \
  --role Contributor \
  --scopes /subscriptions/<SUBSCRIPTION_ID>
```

Copy the JSON output and add to GitHub repo secrets as `AZURE_CREDENTIALS`.

### Step 2: Configure GitHub Secrets

In your GitHub repo, add these secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|-------|
| `AZURE_CREDENTIALS` | Service principal JSON (from Step 1) |
| `SECRET_KEY` | Random 64-char hex: `python -c "import secrets; print(secrets.token_hex(32))"` |
| `ADMIN_PASSWORD` | Admin login password (change from default) |
| `MINISTER_PASSWORD` | Minister login password (change from default) |
| `URL_PREFIX` | *(optional)* Sub-path, e.g. `/ministry` |

### Step 3: Trigger Deployment via GitHub Actions

1. Go to **Actions** tab in your repo
2. Select **Deploy to Azure Container Apps** workflow
3. Click **Run workflow**
4. Fill in:
   - **Environment:** `staging`
   - **Action:** `deploy`
   - **Skip tests:** `false` (unless emergency)
5. Click **Run workflow**

The workflow will:

1. ✓ Validate Bicep templates
2. ✓ Run test suite (docker-integration, frontend, backend, E2E)
3. ✓ Build and push Docker image to GitHub Container Registry
4. ✓ Bootstrap Azure resources (first time only):
   - Create resource group
   - Create storage account + file share (SQLite persistence)
   - Create Container Apps environment
   - Deploy Container App
5. ✓ Deploy to staging, run health checks and smoke tests
6. ✓ Wait for manual approval (if production)
7. ✓ Deploy to production, auto-rollback if health check fails

### Workflow Inputs Reference

| Input | Default | Description |
|-------|---------|-------------|
| `environment` | `staging` | `staging` or `production` |
| `action` | `deploy` | `deploy`, `rollback`, or `destroy` |
| `force_bootstrap` | `false` | Force resource creation (even if RG exists) |
| `skip_tests` | `false` | Skip test suite (emergency use only) |
| `skip_staging` | `false` | Deploy directly to prod (requires approval) |
| `image_tag` | `latest` | Container image tag (e.g. `v1.4.0`, git SHA) |

### Monitoring Deployment

```bash
# Stream workflow logs
gh run watch <run-id>

# Check Container App status
az containerapp show \
  --resource-group minister-rg-staging \
  --name minister-app-staging

# Stream Container App logs
az containerapp logs show \
  --resource-group minister-rg-staging \
  --name minister-app-staging \
  --follow
```

### Environment Variables in Container App

The Bicep templates automatically set:

| Variable | Value |
|----------|-------|
| `FLASK_ENV` | `production` |
| `DATABASE_PATH` | `/data/minister.db` |
| `SQLITE_VFS` | `unix-dotfile` (required for Azure Files) |
| `PORT` | `8080` |
| `URL_PREFIX` | From GitHub secret (if set) |
| `SECRET_KEY` | From GitHub secret |
| `ADMIN_PASSWORD` | From GitHub secret |
| `MINISTER_PASSWORD` | From GitHub secret |

### Database Persistence

- **Storage:** Azure Files (SMB file share)
- **Path:** `/data/minister.db` inside container
- **Quota:** 5 GB (configurable in Bicep parameters)
- **VFS Mode:** `unix-dotfile` (required for SMB compatibility)
- **Backup:** Automatic backup before each deployment (stored in blob storage)

### Updating & Rollback

**To update:**

```bash
# Trigger workflow with new image tag
gh workflow run deploy-aca.yml \
  -f environment=production \
  -f action=deploy \
  -f image_tag=v1.4.1
```

**To rollback:**

```bash
# Trigger workflow with rollback action
gh workflow run deploy-aca.yml \
  -f environment=production \
  -f action=rollback
```

Or manually:

```bash
az containerapp revision list \
  --resource-group minister-rg-production \
  --name minister-app-production

# Activate a previous revision
az containerapp revision activate \
  --resource-group minister-rg-production \
  --name minister-app-production \
  --revision <revision-name>
```

### Scaling

The Container App auto-scales based on CPU:

| Config | Staging | Production |
|--------|---------|------------|
| Min instances | 1 | 2 |
| Max instances | 3 | 5 |
| Scale trigger | CPU > 70% | CPU > 70% |

Adjust in workflow:

```yaml
deploy-production:
  # ... in az deployment group create ...
  --parameters \
    minInstances=2 \
    maxInstances=5
```

### Troubleshooting

**Bicep validation fails:**

```bash
bicep validate infra/main.bicep
```

**Tests fail:**

```bash
# Run tests locally
docker compose up -d
npm install && npm run lint  # frontend
pytest backend/  # backend
```

**Deployment hangs:**

```bash
# Check Container App logs
az containerapp logs show \
  --resource-group minister-rg-staging \
  --name minister-app-staging
```

**Health check fails:**

```bash
# Check if app is responding
curl https://<container-app-fqdn>/health

# Check database connectivity
az containerapp exec \
  --resource-group minister-rg-staging \
  --name minister-app-staging \
  -- ls -la /data/
```

**Database locked error:**

Verify `SQLITE_VFS=unix-dotfile` and `journal_mode=DELETE` are set (both configured automatically by Bicep).

### Documentation

- **Workflow reference:** [.github/DEPLOYMENT_WORKFLOW.md](.github/DEPLOYMENT_WORKFLOW.md)
- **Bicep guide:** [infra/README.md](infra/README.md)
- **GitHub Actions:** [.github/workflows/deploy-aca.yml](.github/workflows/deploy-aca.yml)

---

## Option 6: Other Cloud Platforms

The app runs anywhere that supports Docker and persistent filesystem storage for SQLite.

### General Requirements

1. Build the Docker image (or deploy bare metal)
2. Mount persistent storage at the `DATABASE_PATH` location
3. Set environment variables (see [Environment Variables](#environment-variables))
4. Use a single gunicorn worker (`--workers 1`) for SQLite
5. On network filesystems (SMB/CIFS, NFS without proper locking), set `SQLITE_VFS=unix-dotfile`
6. On any network filesystem, ensure `journal_mode=DELETE` (already set in code)

### AWS

- **ECS/Fargate** - Use the Dockerfile. Mount an EFS volume for persistent SQLite storage.
- **Elastic Beanstalk** - Docker platform. Use EBS for storage.
- **EC2** - Follow the [Bare Metal](#option-1-bare-metal) instructions.

### Azure

- **App Service + Cloudflare Tunnel** - See [Option 4](#option-4-azure-app-service--cloudflare-tunnel-sidecar) for the full multi-container walkthrough with Azure Files persistence.
- **Container Apps** - Similar to Cloud Run. Mount Azure Files for persistence and set `SQLITE_VFS=unix-dotfile`.

### DigitalOcean

- **App Platform** - Docker deployment with managed volumes.
- **Droplet** - Follow the [Bare Metal](#option-1-bare-metal) instructions.

### PaaS (Railway, Render, Fly.io)

- **Fly.io** - Docker deployment with persistent volumes. Good fit for SQLite.
- **Railway** - Docker deployment. Check persistent disk availability.
- **Render** - Docker deployment with persistent disk option.

> **Key consideration:** SQLite requires a persistent filesystem. Ephemeral container storage will lose data on restart. Always verify your platform provides persistent disk mounts.

---

## Putting Cloudflare in Front of Any Deployment

Cloudflare is a good fit in front of *any* of the options above — Bare Metal, Docker, Cloud Run, Azure App Service, AWS, DigitalOcean, Fly.io, etc. — and gives you DNS, TLS termination at the edge, DDoS/WAF protection, and (optionally) zero-trust tunneling so the origin never needs a public IP. This section is platform-agnostic; cross-reference the option-specific guides above for the origin-side details.

### Two integration styles

1. **Cloudflare proxy (orange-cloud DNS)** — easiest. Point an `A` or `CNAME` record at your origin's public address with the proxy enabled. Cloudflare terminates TLS at the edge and forwards to your origin. Works for any deployment that already has a reachable public address (Cloud Run domain mapping, Nginx in front of bare metal, an App Service hostname, an AWS ALB, etc.).

2. **Cloudflare Tunnel (`cloudflared`)** — best. The origin makes an outbound connection to Cloudflare's edge and accepts traffic over that tunnel; nothing needs to be open inbound. Works anywhere you can run a `cloudflared` process, including as a sidecar container next to the app ([Option 4](#option-4-azure-app-service--cloudflare-tunnel-sidecar) is the canonical example), as a systemd unit alongside a bare metal deploy, or as a separate service in `docker-compose.yml`.

### Recommended Cloudflare settings

| Setting | Value | Why |
|---------|-------|-----|
| SSL/TLS mode | **Full (strict)** | The origin already terminates HTTPS in any of the supported setups (gunicorn behind Nginx/Caddy, Cloud Run, App Service, or the tunnel itself). |
| Always Use HTTPS | On | Redirect any HTTP visitor at the edge. |
| Automatic HTTPS Rewrites | On | Avoids mixed-content warnings if any old links are hard-coded to `http://`. |
| Brotli compression | On | Smaller frontend bundle delivery. |
| Bot Fight Mode | On (or Super Bot Fight Mode if you have it) | The admin login is unauthenticated rate-limit-wise, so add a layer. |
| Cache Rules | Bypass cache for `/api/*` and `/health` | API responses are dynamic; caching them breaks admin and player flows. |
| WAF Managed Rules | Cloudflare Managed Ruleset enabled | Cheap baseline coverage for the Flask + SQLite stack. |
| Rate limiting | e.g. 30 req/min per IP on `/api/admin/login` | The app has no built-in rate limiting; do it at the edge. |

### Hardening the origin against direct traffic

Once Cloudflare is in front, lock the origin so it only accepts traffic from Cloudflare. The mechanism depends on the platform:

- **Bare Metal / Nginx** — `allow` blocks for Cloudflare's IPv4 (`https://www.cloudflare.com/ips-v4`) and IPv6 (`https://www.cloudflare.com/ips-v6`) ranges, then `deny all;`.
- **Cloud Run** — combine `--no-allow-unauthenticated` with a Cloud Armor policy that allow-lists Cloudflare IPs, or use Cloudflare Tunnel to skip public ingress entirely.
- **Azure App Service** — `az webapp config access-restriction add` for each Cloudflare CIDR (worked example in [Option 4, Step 6](#step-6-lock-the-origin-down-to-cloudflare)).
- **AWS ALB / API Gateway** — security group / resource policy referencing the AWS-managed Cloudflare prefix list or the published IP ranges.
- **Cloudflare Tunnel deployments** — origin has no public listener at all, so this step is implicit.

> **Token rotation:** Cloudflare's published IP ranges change occasionally. Either subscribe to their notifications or refresh the allowlist on a schedule.

### Path-based hosting through Cloudflare

If you want to host the app at a sub-path (e.g. `https://example.com/ministry/`) so the apex hostname stays available for other services:

1. Set `URL_PREFIX=/ministry` on the running backend container. No rebuild is required — the Flask backend injects a `<base href="/ministry/">` tag into the served `index.html` at request time so the relative asset URLs in the Vite bundle resolve under the prefix.
2. Add a Cloudflare **Origin Rule** or **Worker Route** that forwards `example.com/ministry/*` to your origin, and a Cloudflare Tunnel **Public Hostname** ingress rule (if using a tunnel) pointing at `http://<origin>:8080`. The Flask backend keeps `/health` at the root for health probes — no extra config needed.

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
| `URL_PREFIX` | Sub-path to mount the Flask app under (e.g. `/ministry`) when behind a path-based reverse proxy. `/health` stays at the root for platform health probes. The frontend bundle is prefix-agnostic — `backend/app.py` injects a `<base href>` tag into `index.html` at request time, so the same image works at any prefix without a rebuild. | _(empty — serve at root)_ | No |
| `SQLITE_VFS` | Optional SQLite VFS override. Set to `unix-dotfile` when `DATABASE_PATH` lives on SMB/CIFS (e.g. Azure Files) so SQLite uses on-disk lock files instead of POSIX fcntl byte-range locks. Leave unset on local disks and GCS FUSE. | _(unset)_ | No |

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
