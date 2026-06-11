# Maintenance Workflows Guide

This repository has automated maintenance workflows to keep dependencies secure and code quality high.

## 📦 Dependabot Configuration

**File:** `.github/dependabot.yml`

Dependabot automatically creates pull requests to update dependencies every Monday morning (UTC). It manages:

- **npm packages** (`frontend/`)
- **pip packages** (`backend/`)
- **GitHub Actions** (workflow dependencies)

### Version Constraints

Dependabot ignores semver-major updates for these packages to avoid surprise breaking changes in automated PRs:
- `react`: semver-major updates are ignored and reviewed manually
- `typescript`: semver-major updates are ignored and reviewed manually
- `flask`: semver-major updates are ignored and reviewed manually

### Merging Dependency Updates

1. Dependabot PRs automatically run the full CI suite (tests, linting, type-checking)
2. Once tests pass, it's safe to merge
3. Auto-merge can be enabled if you're confident in test coverage

## 📊 **Workflow Strategy**

### **PR-Blocking Workflows** (must pass before merge)

| Workflow | Checks | Timing |
|----------|--------|--------|
| `backend-tests.yml` | Python syntax check + pytest suite | Every push/PR |
| `frontend-tests.yml` | TypeScript type-check + linting + unit tests | Every push/PR |
| `docker-integration.yml` | Docker build + image size + E2E tests + integration validation | Every push/PR |

**Fast checks run first (<2 min) to catch errors before the 25-min Docker integration test.**

### **Scheduled Maintenance Workflows** (informational, don't block)

| Workflow | Schedule | Purpose |
|----------|----------|---------|
| `security-scan.yml` | Nightly (02:00 UTC) | CodeQL analysis + vulnerability scanning |

## 🔄 **Workflow Details**

### Backend Tests (`backend-tests.yml`)

Runs on every push/PR.

1. **Check Python syntax** (1s) — catches import/syntax errors early
2. **Run pytest** (5-10 min) — full backend test suite

### Frontend Tests (`frontend-tests.yml`)

Runs on every push/PR.

1. **Check TypeScript types** (10-30s) — catches type errors early
2. **Verify dependency tree** (5s) — ensures npm tree is healthy after install
3. **Check deprecated dependencies** (10s) — warns if packages are obsolete
4. **Run linter** (1-2 min) — code style & quality checks
5. **Run unit tests (vitest)** (5-10 min) — frontend unit test suite

### Docker Integration (`docker-integration.yml`)

Runs on every push/PR. **The definitive integration test.**

- Builds Docker image with caching
- Validates image size (<200 MB)
- Runs health checks and smoke tests
- Runs Playwright E2E tests (full user flows)
- Validates URL_PREFIX routing (build-once/deploy-anywhere)
- Tests both default and `/ministry` prefix configurations

### Security Scan (`security-scan.yml`)

Runs **nightly at 02:00 UTC** (not on every PR to save runner resources).

Tools:
- **CodeQL** — detects vulnerabilities and bugs
- **Safety** — checks Python dependencies for known CVEs
- **npm audit** — checks Node dependencies for security issues

Results are informational; don't block merges.

## 🚀 Recommended Branch Protection Rules

To enforce quality gates, add these branch protection rules on `main`:

1. ✅ Require pull request reviews before merging (1 approval)
2. ✅ Require status checks to pass:
   - `Backend Tests / pytest`
   - `Frontend Tests / lint`
   - `Frontend Tests / vitest`
   - `Docker Smoke & E2E Tests / smoke-and-e2e`
3. ✅ Require branches to be up to date before merging
4. ✅ Allow auto-merge (enables quick Dependabot PR merges)

## 📚 Documentation Requirements

Whenever you:
- Add/modify an API endpoint
- Add/modify a database column
- Add/modify an environment variable

**Update all affected docs in the same commit.**

## 🔄 Running Workflows Manually

All workflows can be triggered manually from the **Actions** tab in GitHub:

```bash
gh workflow run backend-tests.yml
gh workflow run frontend-tests.yml
gh workflow run docker-integration.yml
gh workflow run security-scan.yml
```

## 🔄 PR Feedback Timeline

For a typical PR, expect:

1. **Immediate (< 1 min)** — Python syntax + TypeScript type-check ✅
2. **1-5 minutes** — Dependency tree check + linting + deprecated deps ✅
3. **5-10 minutes** — Unit tests (backend + frontend) ✅
4. **25 minutes** — Docker build + E2E tests ✅

All must pass before merge. **Total time: ~30 minutes.**

## 🐛 Troubleshooting

### "Dependabot can't find your dependencies"
- Ensure `.github/dependabot.yml` is on the default branch (`main`)
- Wait 24 hours; Dependabot picks up changes automatically

### "CodeQL is taking too long"
- CodeQL runs nightly, not on every PR, to save runner time
- First run takes 5-10 min; subsequent runs are faster due to caching

### "Docker build exceeds size limit"
- Docker image must be < 200 MB
- Check `docker image ls` locally for bloat
- Consider multi-stage build optimizations

---

For detailed instructions on maintaining this codebase, see [claude.md](../claude.md) and [copilot-instructions.md](copilot-instructions.md).
