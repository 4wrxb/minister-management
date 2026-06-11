# Azure Container Apps Deployment Workflow Guide

This guide explains the GitHub Actions deployment workflow (`.github/workflows/deploy-aca.yml`) for the Ministry Management System on Azure Container Apps.

## Overview

The deployment workflow is **config-driven** via `workflow_dispatch` inputs, allowing operators to:

- Choose environment (staging or production)
- Select action (deploy, rollback, or destroy)
- Skip tests for emergency hotfixes (requires approval)
- Skip staging for direct production deployment (requires approval)

```
Validate Config
    ↓
Validate Bicep
    ↓
Run Test Suite
    ↓
Build & Push Image
    ↓
Bootstrap Resources (if needed)
    ├─ Staging Path
    │   ├─ Deploy to Staging
    │   └─ Smoke Tests
    │
    └─ Production Path
        ├─ Approval Gate (manual)
        ├─ Deploy to Production
        ├─ Health Check & Auto-Rollback
        └─ Post-Deployment Checks
```

## Triggering the Workflow

### Via GitHub UI

1. Go to **Actions** tab
2. Select **Deploy to Azure Container Apps** workflow
3. Click **Run workflow**
4. Fill in the inputs:
   - **Environment:** `staging` or `production`
   - **Action:** `deploy`, `rollback`, or `destroy`
   - **Other options:** Check as needed
5. Click **Run workflow**

### Via GitHub CLI

```bash
gh workflow run deploy-aca.yml \
  -f environment=staging \
  -f action=deploy \
  -f force_bootstrap=false \
  -f skip_tests=false
```

## Workflow Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `environment` | choice | `staging` | `staging` or `production` |
| `action` | choice | `deploy` | `deploy`, `rollback`, or `destroy` |
| `force_bootstrap` | boolean | `false` | Force resource creation even if RG exists |
| `skip_tests` | boolean | `false` | Skip test suite (requires approval, emergency use only) |
| `skip_staging` | boolean | `false` | Deploy directly to prod (requires approval) |
| `image_tag` | string | `latest` | Container image tag (e.g., `v1.4.0`, git SHA) |

## Job Descriptions

### 1. `validate-config`

**Purpose:** Validate workflow inputs and compute derived values.

**Outputs:**
- `image-uri` — Full container image URI for deployment
- `resource-group` — Azure resource group name

**Behavior:**
- Verifies environment is `staging` or `production`
- Constructs image URI: `ghcr.io/<owner>/minister-management:latest`
- Constructs RG name: `minister-rg-<environment>`

---

### 2. `validate-bicep`

**Purpose:** Lint and validate Bicep templates before deployment.

**Steps:**
1. Download Bicep CLI
2. Run `bicep validate` on `infra/main.bicep`
3. Check for hardcoded values (anti-pattern)

**Failure Condition:** Invalid Bicep syntax or validation errors.

---

### 3. `test-suite`

**Purpose:** Run backend tests, frontend tests, and E2E tests.

**Conditions:**
- Skipped if `skip_tests=true`
- Runs docker-compose with test harness

**Steps:**
1. Build Docker image
2. Start containers via docker-compose
3. Wait for `/health` endpoint (60s timeout)
4. Run Playwright E2E tests
5. Check logs for errors/crashes
6. Tear down containers

**Timeout:** 30 minutes

**Outputs:** Test results, Playwright report (on failure)

---

### 4. `build-image`

**Purpose:** Build and push container image to registry.

**Conditions:**
- Only runs if `test-suite` passed (or `skip_tests=true`)

**Steps:**
1. Log in to GitHub Container Registry (GHCR)
2. Build image using existing Dockerfile
3. Tag with:
   - `image_tag` parameter (e.g., `latest`)
   - Git commit SHA for traceability
4. Push to GHCR
5. Output image digest for audit trail

**Outputs:**
- `image-digest` — SHA256 digest of pushed image
- Full image URI recorded in logs

---

### 5. `bootstrap`

**Purpose:** Create Azure resource group and resources if they don't exist (idempotent).

**Conditions:**
- Only runs for `action=deploy` or `force_bootstrap=true`

**Steps:**
1. Check if resource group exists
2. If missing:
   - Create resource group
   - Trigger full Bicep deployment
3. If exists:
   - Skip (subsequent deployments reuse the RG)

**Outputs:**
- `rg-created` — `true` if RG was just created, `false` if pre-existing

---

### 6. `deploy-staging`

**Purpose:** Deploy to staging environment with health checks and smoke tests.

**Conditions:**
- `environment=staging` AND `action=deploy`
- Does not run if `skip_staging=true` (production-only flow)

**Steps:**
1. Backup current database from Azure Files
2. Deploy via Bicep:
   - Create/update Container App
   - Mount Azure Files for SQLite
   - Set environment variables and secrets
3. Wait for app to become healthy (300s timeout)
   - Poll `/health` endpoint every 10 seconds
4. Run smoke tests:
   - `GET /health` → 200 OK
   - `GET /api/settings/research-day` → 200 OK
5. If any step fails:
   - Attempt rollback from backup
   - Fail workflow

**Outputs:**
- `app-url` — HTTPS URL to staging Container App
- Health status

**Environment:** Staging (requires no approval)

---

### 7. `approval-gate`

**Purpose:** Require manual approval before production deployment.

**Conditions:**
- `environment=production` AND `action=deploy`

**Behavior:**
- Workflow pauses and waits for GitHub environment approval
- Team members with admin/maintainer role can approve or reject
- Rejection cancels remaining jobs

**Duration:** No timeout; waits indefinitely for approval.

---

### 8. `deploy-production`

**Purpose:** Deploy to production with rollback safety.

**Conditions:**
- `environment=production` AND approved by approval-gate

**Steps:**
1. Backup current database
2. Deploy via Bicep with production parameters:
   - `minInstances=2` (always-on HA)
   - `maxInstances=5` (aggressive scaling available)
   - Environment=production
3. Wait for health check (5-minute timeout):
   - Poll `/health` every 15 seconds
   - If health check fails: Auto-rollback to previous revision
4. Log deployment details

**Outputs:**
- `app-url` — HTTPS URL to production Container App
- Health status

**Environment:** Production (requires approval + potential secret access)

**Auto-Rollback Trigger:** If `/health` does not return 200 OK within 5 minutes after deployment.

---

### 9. `post-deployment-checks`

**Purpose:** Verify deployment, log metadata, and generate status report.

**Conditions:**
- Runs after successful deployment (staging or production)

**Steps:**
1. Query Bicep deployment outputs
2. Extract and log:
   - Container App URL
   - Storage account name
   - Deployment timestamp
   - Image digest
3. Print deployment summary

---

### 10. `deployment-status`

**Purpose:** Final status check and workflow conclusion.

**Behavior:**
- Reports overall success/failure
- Fails job if any prior job failed
- Provides clear success/failure message

---

## Decision Points & Conditional Logic

### Staging vs. Production

| Scenario | Flow |
|----------|------|
| `environment=staging`, `action=deploy` | `validate → build → bootstrap → deploy-staging → checks` |
| `environment=staging`, `skip_staging=true` | Invalid (staging cannot be skipped) |
| `environment=production`, `action=deploy` | `validate → build → bootstrap → approval-gate → deploy-production → checks` |
| `environment=production`, `skip_staging=true` | Skip staging, go directly to production approval gate |

### Skip Tests (Emergency Hotfix)

```yaml
if skip_tests=true:
  ├─ Build and push image IMMEDIATELY (no test suite)
  ├─ Log WARNING: "Skipping tests — risky"
  └─ Proceed to deployment
else:
  ├─ Run full test suite
  └─ If tests fail: stop, do not proceed
```

### Rollback Logic

**Automatic Rollback (Production Only):**
- If health check fails after 5 min → revert to previous Container App revision
- Logs rollback reason in workflow output

**Manual Rollback:**
```bash
gh workflow run deploy-aca.yml \
  -f environment=production \
  -f action=rollback
```

---

## Secrets & Configuration

The workflow uses GitHub Secrets (must be configured in repo settings):

| Secret | Usage | Required |
|--------|-------|----------|
| `AZURE_CREDENTIALS` | Azure CLI login (JSON service principal) | Yes |
| `SECRET_KEY` | Flask session secret | Yes |
| `ADMIN_PASSWORD` | Admin login password | Yes |
| `MINISTER_PASSWORD` | Minister login password | Yes |
| `URL_PREFIX` | Sub-path for app (e.g., `/ministry`) | No |

### Setting Up Azure Credentials

```bash
# Create a service principal with Contributor role
az ad sp create-for-rbac --name "minister-deployment" --role Contributor

# Copy the JSON output and add as GitHub Secret: AZURE_CREDENTIALS
```

---

## Monitoring & Debugging

### View Workflow Logs

```bash
# List recent runs
gh run list --workflow deploy-aca.yml

# View specific run
gh run view <run-id> --log

# Stream live logs
gh run watch <run-id>
```

### Common Failure Scenarios

| Scenario | Cause | Fix |
|----------|-------|-----|
| Bicep validation fails | Syntax error in `.bicep` files | Check `az bicep validate` output |
| Tests fail | Test suite errors | Fix code or `skip_tests=true` for hotfix |
| Bootstrap fails | RG creation permission denied | Check AZURE_CREDENTIALS has Contributor role |
| Deployment hangs | Container App slow to start | Check Container App logs in Azure portal |
| Health check fails | App not responding on `/health` | Check backend logs, database connectivity |
| Auto-rollback triggered | Deployment unhealthy | Manual investigation required |

### Check Deployment Status in Azure

```bash
# Get Container App status
az containerapp show \
  --resource-group minister-rg-staging \
  --name minister-app-staging

# Stream Container App logs
az containerapp logs show \
  --resource-group minister-rg-staging \
  --name minister-app-staging \
  --follow
```

---

## Best Practices

1. **Always test in staging first** before production
2. **Don't skip tests** unless it's a genuine emergency hotfix
3. **Require approval** for production deployments (GitHub environment setting)
4. **Monitor health after deployment** — auto-rollback helps but manual review is best
5. **Keep backups** — database backup before every deploy
6. **Tag images** — use version tags (e.g., `v1.4.0`) for releases, not just `latest`
7. **Audit trail** — workflow logs, image digests, and deployment metadata are recorded

---

## Troubleshooting Guide

### Workflow Hangs at Approval Gate

**Symptom:** Workflow pauses indefinitely after `approval-gate` job.

**Cause:** Waiting for manual approval.

**Fix:** 
1. Go to workflow run
2. Click **Review deployments**
3. Select **production** environment
4. Click **Approve and deploy** or **Reject**

---

### Health Check Fails, Auto-Rollback Triggered

**Symptom:** Production deployment logs show health check timeout, auto-rollback initiated.

**Cause:** Container App not responding to `/health` within 5 minutes.

**Fixes:**
1. Check backend logs: `az containerapp logs show …`
2. Verify image is correct: `az deployment group show … --query properties.outputs`
3. Check database connectivity (Azure Files mounted?)
4. Manual review: was the rollback successful?

---

### Image Push Fails (Auth Error)

**Symptom:** Build job fails at "Log in to Container Registry"

**Cause:** `GITHUB_TOKEN` expired or permissions insufficient.

**Fix:** 
1. Verify GitHub token has `write:packages` scope
2. Check GitHub Actions permissions in repo settings

---

### Bicep Validation Fails

**Symptom:** `validate-bicep` job fails with syntax error.

**Cause:** `.bicep` file has invalid syntax.

**Fix:**
1. Run locally: `bicep validate infra/main.bicep`
2. Fix errors
3. Commit and retry workflow

---

## Related Documentation

- [Bicep Architecture Guide](../infra/README.md)
- [Deployment Options](../DEPLOYMENT.md)
- [Azure Container Apps Docs](https://learn.microsoft.com/en-us/azure/container-apps/)
- [GitHub Actions Workflow Syntax](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions)

