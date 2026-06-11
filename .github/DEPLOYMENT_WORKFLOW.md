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
Build & Push Image  ─────────────────┐
    ↓                                │
Verify GHCR Package Is Public  ←─────┘  (preflight; fails fast if private)
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
  -f force_bootstrap=false
```

## Workflow Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `environment` | choice | `staging` | `staging` or `production` |
| `action` | choice | `deploy` | `deploy`, `rollback`, or `destroy` |
| `force_bootstrap` | boolean | `false` | Force resource creation even if RG exists |
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

### 3. `build-image`

**Purpose:** Build and push container image to registry.

**Conditions:**
- Runs after `validate-bicep` succeeds.

> **Why no separate test job here?** `docker-integration.yml` (smoke + Playwright E2E + lint + pytest + vitest) runs on every push to `main` as required checks. Because `deploy-aca.yml` is dispatched manually from `main`, the same commit has already had its full test suite go green. Re-running it here would just duplicate ~5 minutes of work and another failure surface. If you need to gate deployment on a specific commit's check status, look at the run for that commit under the Actions tab before dispatching.

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

### 5. `verify-package-visibility`

**Purpose:** Fail fast if the GHCR package is not pullable by Azure Container Apps.

**Why this exists:** ACA pulls images anonymously (the Container App has no `registries` block, intentionally — see [Container Image Registry & Visibility](#container-image-registry--visibility) for the security rationale). GitHub creates new packages as private by default, so on the very first deploy the operator has to make the package public. This job catches that mistake in seconds instead of letting ACA bootstrap fail 5–10 minutes later with a cryptic `DENIED` error.

**Conditions:**
- Always runs after `build-image` succeeds.

**Steps:**
1. Probe the repo owner via `GET /users/{owner}` to decide between the user and org packages endpoint.
2. Call `GET /{users|orgs}/{owner}/packages/container/minister-management` with `GITHUB_TOKEN`.
3. If the package is missing or visibility ≠ `public`, fail with a helpful error message that includes:
   - The exact package settings URL to open
   - Instructions to either flip visibility to **Public** or enable **Inherit access from source repository** (works because the Dockerfile sets `org.opencontainers.image.source`)
   - A pointer to `DEPLOYMENT.md` Option 5 Step 0 and to this guide's security audit

**Permissions:** `packages: read` (added at the job level; does not affect other jobs).

**One-time setup:** On the very first deploy this job WILL fail because `build-image` has just created the package as private. That is the expected behavior — fix it once via the URL in the error message and re-run; from then on this job passes in < 5 seconds on every run.

---

### 6. `bootstrap`

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

### 7. `deploy-staging`

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

### 8. `approval-gate`

**Purpose:** Require manual approval before production deployment.

**Conditions:**
- `environment=production` AND `action=deploy`

**Behavior:**
- Workflow pauses and waits for GitHub environment approval
- Team members with admin/maintainer role can approve or reject
- Rejection cancels remaining jobs

**Duration:** No timeout; waits indefinitely for approval.

---

### 9. `deploy-production`

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

### 10. `post-deployment-checks`

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

### 11. `deployment-status`

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

## Container Image Registry & Visibility

The workflow builds the image with `docker/build-push-action` and pushes it to **GitHub Container Registry** (`ghcr.io/<owner>/minister-management`). The push side authenticates with the workflow's auto-provided `GITHUB_TOKEN`, so **no `GHCR_PAT` secret is required for pushing**.

The Container App pulls the image **anonymously** — `aca.bicep` deliberately does not declare a `registries` block. This means the GHCR package **must be public**. There is no in-workflow automation that flips visibility, because doing so would require a long-lived PAT with `admin:packages` scope just to be used once per repo.

Instead, the workflow's `verify-package-visibility` job (described above) fails fast with a clear error if the package isn't public, and the operator does a one-time UI toggle. Once done, it never needs to be revisited.

### Why public GHCR is safe for this codebase — security audit

Verified by inspecting Dockerfile, .dockerignore, the frontend Vite build, and backend source:

| Surface | Finding |
|---------|---------|
| `Dockerfile` | No `ARG`, no `--build-arg`, no `--mount=type=secret`. Baked `ENV` is only `FLASK_ENV=production`, `PYTHONUNBUFFERED=1`, `PORT=8080`, `DATABASE_PATH=/data/minister.db` — none are secrets. |
| `.dockerignore` | Excludes `.env*`, `*.db`, `*.sqlite*`, `.git/`. |
| `.env` in repo | None. Only `.env.example` (placeholders). |
| Frontend Vite build | Zero `import.meta.env.VITE_*` / `process.env.*` references in `frontend/src/`. Nothing baked into the JS bundle. |
| Backend source | All credentials are read with `os.getenv(...)` at runtime. Defaults are placeholder values (`dev-secret-key`, `admin123`). |
| `WOS_API_SECRET` fallback | Documented in `claude.md` as a public client-side constant from the WOS game client. |
| Runtime credentials | `SECRET_KEY`, `ADMIN_PASSWORD`, `MINISTER_PASSWORD`, `URL_PREFIX` flow in at runtime via ACA `secrets` block. Not in image. |

**Conclusion:** the image contains nothing that isn't already in the public GitHub repo. Public GHCR is the right choice at this scale.

### Provenance label

The `Dockerfile` sets:

```
LABEL org.opencontainers.image.source="https://github.com/4wrxb/minister-management"
LABEL org.opencontainers.image.description="Whiteout Survival ministry-position scheduling system"
LABEL org.opencontainers.image.title="minister-management"
```

GHCR uses `image.source` to auto-connect the package to the repo on first push. This makes the package surface on the repo's Packages tab and enables the **Inherit access from source repository** option in the package settings — which is the lowest-risk way to flip visibility to public for a public repo.

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

> **No `GHCR_PAT`, `GHCR_USERNAME`, or registry-credential secret is needed** — image pushes use `GITHUB_TOKEN` automatically and image pulls are anonymous (against a public package).

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
| Bicep validation fails | Syntax error in `.bicep` files | Check `bicep build` / `bicep lint` output |
| Required CI checks red on `main` | smoke / E2E / lint failed on the merged commit | Fix the underlying problem on `main` before dispatching `deploy-aca.yml`. This workflow assumes the SHA being deployed is already known-good. |
| `verify-package-visibility` fails | GHCR package is private (default for new packages) | See [GHCR Pull Denied / Package Is Private](#ghcr-pull-denied--package-is-private) below |
| Bootstrap fails | RG creation permission denied | Check `AZURE_CREDENTIALS` has Contributor role |
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

### GHCR Pull Denied / Package Is Private

**Symptom:** Either the `verify-package-visibility` preflight job fails with a `package is 'private'` error, or — if the preflight is somehow bypassed — the `deploy-staging` / `deploy-production` job times out at "Wait for app to be healthy" and the Container App logs show `DENIED: requested access to the resource is denied` against `ghcr.io/<owner>/minister-management:<tag>`.

**Cause:** GitHub creates new container packages as **private** by default, even when the source repo is public. ACA pulls anonymously (the Container App has no `registries` block, intentionally — see [Container Image Registry & Visibility](#container-image-registry--visibility)), so a private package cannot be pulled.

**Fix (one-time per repo):**

1. Open the package settings URL printed in the `verify-package-visibility` job error. It will look like:
   - User repo: `https://github.com/users/<owner>/packages/container/minister-management/settings`
   - Org repo: `https://github.com/orgs/<owner>/packages/container/minister-management/settings`
2. In the **Danger Zone**, click **Change visibility** → **Public** → confirm. *(Alternatively, in the **Manage Actions access** / **Inherit access from source repository** section, enable repo-inherited access. Either makes the package pullable; for public repos these end up equivalent.)*
3. Re-run the failed workflow. The preflight will now pass in under five seconds.

**Why we don't automate this:** Flipping visibility requires a PAT with `admin:packages` scope; the workflow's built-in `GITHUB_TOKEN` cannot do it. Adding a long-lived PAT for a one-time-per-repo click is the wrong trade-off — the preflight job catches this mistake reliably and the security audit in [Container Image Registry & Visibility](#container-image-registry--visibility) confirms that public GHCR is safe for this codebase.

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

