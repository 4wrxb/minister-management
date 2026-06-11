# Test Suite Overview

This project has three independent test layers, plus one Docker smoke workflow.
The matrix below combines suite overview and CI wiring in one place.

| Layer | Framework | Location | Speed | Needs Docker? | CI workflow | CI run |
|---|---|---|---|---|---|---|
| **Backend unit** | pytest + Flask test client | `tests/backend/` | ~seconds | No | `.github/workflows/backend-tests.yml` | `pytest tests/backend/` |
| **Frontend unit** | Vitest + React Testing Library | `frontend/src/__tests__/` (plan in `tests/frontend/`) | ~seconds | No | `.github/workflows/frontend-tests.yml` | `npm run lint` + `npm test` |
| **E2E integration** | Playwright (Chromium) | `tests/e2e/` | ~1–3 min | **Yes** | `.github/workflows/e2e-tests.yml` | Docker build + Playwright browser flows |
| **Container smoke** | curl + container log checks | `.github/workflows/docker-integration.yml` | ~1–3 min | **Yes** | `.github/workflows/docker-integration.yml` | Docker build/startup + health/static/log checks |

---

## Quick-Start: Run All Tests Locally

```bash
# ── Backend ───────────────────────────────────────────────────────────────────
pip install -r backend/requirements.txt -r tests/backend/requirements.txt
pytest tests/backend/ -v

# ── Frontend ──────────────────────────────────────────────────────────────────
cd frontend
npm ci
npm test
cd ..

# ── E2E (requires Docker) ─────────────────────────────────────────────────────
docker compose up -d --build
# wait for: curl http://localhost:8080/health
cd tests/e2e
npm install
npx playwright install --with-deps chromium
npx playwright test
cd ../..
docker compose down -v
```

---

## Detailed Test Plans

- **[Backend Test Plan](backend/TESTPLAN.md)** — API test coverage, pytest setup, Scenario runner pattern
- **[Frontend Test Plan](frontend/TESTPLAN.md)** — component test coverage, Vitest setup, mock strategy
- **[E2E Test Plan](e2e/TESTPLAN.md)** — browser flow coverage, Playwright setup, seed fixture pattern

---

## Production Isolation

None of the test code ships to production:

- `Dockerfile` only `COPY`s `backend/` and `frontend/dist/` — `tests/` is never touched
- `tests/` is listed in `.dockerignore` as an explicit safeguard
- Frontend test deps are `devDependencies` — excluded from the Vite production bundle
- `tests/backend/requirements.txt` and `tests/e2e/package.json` are separate from
  `backend/requirements.txt` (the only deps file the container uses)
