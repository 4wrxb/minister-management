# Azure Container Apps Infrastructure (Bicep)

This directory contains the Infrastructure-as-Code (Bicep) templates for deploying the Ministry Management System to **Azure Container Apps** with SQLite persisted on **Azure Files**.

These templates are deployed by `.github/workflows/deploy-aca.yml`. You can also run them directly with `az deployment group create` (see [Manual Deployment](#manual-deployment) below).

## Architecture

```
main.bicep (orchestrator, accepts all params + secrets)
 ├── storage.bicep
 │    ├── Microsoft.Storage/storageAccounts                  (Standard_LRS, StorageV2)
 │    ├── ./fileServices/shares/minister-data                (SMB file share, mounted at /data)
 │    └── ./blobServices/containers/backups                  (pre-deploy DB snapshots)
 └── aca.bicep
      ├── Microsoft.OperationalInsights/workspaces           (Log Analytics for stdout/stderr)
      ├── Microsoft.App/managedEnvironments                  (ACA env, links Log Analytics)
      ├── ./storages/minister-data                           (binds the Azure Files share)
      └── Microsoft.App/containerApps                        (the Flask app)
           ├── env vars (FLASK_ENV, DATABASE_PATH, SQLITE_VFS, URL_PREFIX, PORT)
           ├── secrets  (secret-key, admin-password, minister-password)
           ├── volume mount → /data → Azure Files share
           ├── probes: Startup / Liveness / Readiness on /health
           └── scale rule: HTTP concurrency-based (50 req/replica)
```

There is intentionally **no managed identity / ACR pull configuration**. The current workflow uses **GitHub Container Registry (`ghcr.io`)** with a public image, so the Container App pulls anonymously. If you switch to ACR with a private image, add a `registries` block in `aca.bicep` and assign `AcrPull` to a managed identity.

## Files

| File | Purpose |
|------|---------|
| `main.bicep` | Root orchestrator. Declares all params, composes `storage` + `aca` modules, surfaces outputs. |
| `storage.bicep` | Storage account, Azure Files share (`minister-data`), and `backups` blob container. |
| `aca.bicep` | Log Analytics workspace, Container Apps managed environment, env-storage binding, and Container App. |

## `main.bicep` Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `environmentName` | string | `staging` | `staging` or `production` |
| `location` | string | `resourceGroup().location` | Azure region |
| `containerImage` | string | *(required)* | Full image URI, e.g. `ghcr.io/4wrxb/minister-management:v1.4.0` |
| `secretKey` | securestring | *(required)* | Flask `SECRET_KEY` |
| `adminPassword` | securestring | *(required)* | `ADMIN_PASSWORD` |
| `ministerPassword` | securestring | *(required)* | `MINISTER_PASSWORD` |
| `fileShareQuota` | int | `5` | Azure Files quota in GB (1–100) |
| `containerMemory` | string | `1.0Gi` | Must be a valid ACA memory string and pair correctly with `containerCpu` |
| `containerCpu` | string | `0.5` | vCPU (e.g. `0.25`, `0.5`, `1.0`) |
| `urlPrefix` | string | *(empty)* | Sub-path mount (e.g. `/ministry`); empty = root |
| `minReplicas` | int | `1` | Always-on minimum |
| `maxReplicas` | int | `3` | Scale ceiling |
| `extraTags` | object | `{}` | Merged on top of `{ project, environment, managed-by }` |

The two leaf modules (`storage.bicep`, `aca.bicep`) declare their own params and receive everything from `main.bicep` — there is **no shared parameter file**.

## `main.bicep` Outputs

These flow back to the GitHub Actions workflow and `scripts/github-configure.sh`:

| Output | Description |
|--------|-------------|
| `resourceGroupName` | RG the deployment landed in |
| `environmentName` | `staging` or `production` |
| `storageAccountName` | Name of the storage account (also used for backups) |
| `fileShareName` | `minister-data` (mounted at `/data`) |
| `backupContainerName` | `backups` (blob container for pre-deploy snapshots) |
| `blobEndpoint` | `https://<account>.blob.core.windows.net/` |
| `containerAppFqdn` | Bare FQDN (no scheme) |
| `containerAppUrl` | `https://<fqdn>` |
| `containerAppName` | `minister-app-<env>` |
| `managedEnvName` | `minister-env-<env>` |
| `logAnalyticsId` | Workspace resource ID for KQL queries |

## Manual Deployment

You don't have to use the workflow — these templates run standalone with `az`.

### Validate

```bash
az bicep build --file infra/main.bicep --stdout > /dev/null && echo OK
```

### Deploy to staging

```bash
RG=minister-rg-staging
LOCATION=eastus

az group create --name "$RG" --location "$LOCATION"

az deployment group create \
  --resource-group "$RG" \
  --template-file infra/main.bicep \
  --parameters \
    environmentName=staging \
    containerImage=ghcr.io/4wrxb/minister-management:latest \
    secretKey="$(python3 -c 'import secrets; print(secrets.token_hex(32))')" \
    adminPassword="$(openssl rand -base64 24)" \
    ministerPassword="$(openssl rand -base64 24)"
```

### Read outputs

```bash
az deployment group show \
  --resource-group "$RG" \
  --name main \
  --query properties.outputs \
  -o json
```

### Tear down

```bash
az group delete --name minister-rg-staging --yes --no-wait
```

## What's Different vs. App Service Deployment (Option 4)

| Aspect | Option 4 (App Service + Cloudflare Tunnel) | This (Container Apps) |
|--------|--------------------------------------------|------------------------|
| TLS / public URL | Cloudflare Tunnel + Cloudflare DNS | ACA-managed `<app>.<region>.azurecontainerapps.io` |
| Origin reachable | No (tunnel only) | Yes (public HTTPS FQDN) |
| Container runtime | App Service multi-container compose | Container Apps revisions |
| Storage | Azure Files via App Service storage binding | Azure Files via ACA `managedEnvironments/storages` |
| SQLite | `SQLITE_VFS=unix-dotfile`, `journal_mode=DELETE` | Same — both required on SMB |
| Scaling | App Service Plan tier (B1 etc.) | ACA replicas (HTTP concurrency rule) |
| Health probes | Single App Service ping | ACA Startup + Liveness + Readiness on `/health` |

## Key Configuration Notes

### SQLite on Azure Files

`aca.bicep` sets:

```bicep
{ name: 'SQLITE_VFS',    value: 'unix-dotfile' }
{ name: 'DATABASE_PATH', value: '/data/minister.db' }
```

- **`SQLITE_VFS=unix-dotfile`** is required because Azure Files (SMB) does not honour POSIX `fcntl` byte-range locks reliably. Dotfile locks live on disk.
- **`journal_mode=DELETE`** is set in `backend/database.py` for the same reason — WAL mode races on the `-shm`/`-wal` sidecar files over SMB.

### Probes

Configured in `aca.bicep`:

| Probe | Path | Initial delay | Period | Failure threshold |
|-------|------|---------------|--------|-------------------|
| Startup | `/health` | 5s | 5s | 12 (≈60s total) |
| Liveness | `/health` | 30s | 30s | 3 |
| Readiness | `/health` | 5s | 10s | 3 |

Backend `/health` stays mounted at the root even when `URL_PREFIX` is set — `backend/app.py` uses `DispatcherMiddleware` precisely so platform probes don't need to know the prefix.

### Scaling

Currently the scale rule is **HTTP concurrency-based** (target: 50 in-flight requests per replica), not CPU-based, because ACA HTTP scaling is more appropriate for the request-pattern of a small admin app:

```bicep
scale: {
  minReplicas: minReplicas
  maxReplicas: maxReplicas
  rules: [{
    name: 'http-scale'
    http: { metadata: { concurrentRequests: '50' } }
  }]
}
```

If you find you need CPU-based scaling instead, swap the `http` block for a `custom` rule (`type: 'cpu'`).

## Validation

Locally (no Azure account needed):

```bash
# Install Bicep
curl -sLo bicep https://github.com/Azure/bicep/releases/latest/download/bicep-linux-x64
chmod +x bicep && sudo mv bicep /usr/local/bin/

# On systems missing libicu, set:
export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1

# Type-check
bicep build infra/main.bicep --stdout > /dev/null && echo "main OK"
bicep build infra/aca.bicep  --stdout > /dev/null && echo "aca OK"
bicep build infra/storage.bicep --stdout > /dev/null && echo "storage OK"

# Lint
bicep lint infra/main.bicep
bicep lint infra/aca.bicep
bicep lint infra/storage.bicep
```

Against a real subscription:

```bash
az deployment group what-if \
  --resource-group minister-rg-staging \
  --template-file infra/main.bicep \
  --parameters \
    environmentName=staging \
    containerImage=ghcr.io/4wrxb/minister-management:latest \
    secretKey=placeholder adminPassword=placeholder ministerPassword=placeholder
```

## Troubleshooting

### `OperationalError: database is locked` on startup
`SQLITE_VFS=unix-dotfile` missing or storage mount failed. Check the Container App revision logs in Log Analytics and confirm the env var is set:

```bash
az containerapp show -g <rg> -n minister-app-<env> \
  --query 'properties.template.containers[0].env[?name==`SQLITE_VFS`]'
```

### Container App stuck in `Provisioning`
Usually the storage mount or image pull is failing. Tail revision logs:

```bash
az containerapp logs show -g <rg> -n minister-app-<env> --follow
```

### Revision unhealthy after deploy
Check that `/health` is reachable inside the container. The Startup probe gives you ~60s before failing; if `gunicorn` takes longer to bind 0.0.0.0:8080 on first boot (cold mount of Azure Files), increase `failureThreshold` on the Startup probe in `aca.bicep`.

### Bicep `build` fails with `ICU package not installed`
This is a .NET runtime requirement on minimal Linux images. Use the workaround:

```bash
export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
```

Or install `libicu-dev` (`apt-get install -y libicu-dev`).

## Related Documentation

- [Workflow guide](../.github/DEPLOYMENT_WORKFLOW.md) — How `deploy-aca.yml` orchestrates these templates
- [DEPLOYMENT.md → Option 5](../DEPLOYMENT.md#option-5-azure-container-apps-automated) — End-to-end deployment walkthrough
- [Azure Container Apps reference](https://learn.microsoft.com/azure/container-apps/)
- [Bicep file reference](https://learn.microsoft.com/azure/azure-resource-manager/bicep/file)
