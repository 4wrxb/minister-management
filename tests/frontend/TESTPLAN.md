# Frontend Unit Test Plan

## Overview

**Framework:** Vitest + React Testing Library (`@testing-library/react`)  
**Test files:** `frontend/src/__tests__/` ← test source lives here  
**Config:** `frontend/vitest.config.ts`  
**Environment:** `jsdom` (browser-like DOM emulation, no real browser)  
**Speed:** ~2–10 seconds for the full suite

> **Why `frontend/src/__tests__/` and not here?**  
> Vite's module resolver walks up from the importing file's directory to find
> `node_modules/`. Keeping test files inside `frontend/src/` means they can
> resolve `@testing-library/*`, `vitest`, and `react` from `frontend/node_modules/`
> without any symlinks or workarounds.  
> Test files are excluded from the production TypeScript build (`tsconfig.json`
> `exclude`) and from the Docker image (`.dockerignore`), so nothing leaks into
> a production deployment.

---

## Running Manually

```bash
cd frontend
npm install    # installs all deps including devDependencies
npm test       # single pass
npm run test:watch   # watch mode — re-runs on file change
```

### Run a specific test file

```bash
cd frontend
npx vitest run src/__tests__/AdminLogin.test.tsx
```

---

## CI Workflow

**File:** `.github/workflows/frontend-tests.yml`  
**Triggers:** push or PR to `main`, manual `workflow_dispatch`  
**Runner:** `ubuntu-latest`, Node.js 20.19

| Job | Steps | Gating? |
|---|---|---|
| `lint` | checkout → Node setup → `npm ci` → `npm run lint` | Yes |
| `vitest` | checkout → Node setup → `npm ci` → `npm test` | Yes |

> Docker is **not** required. The suite runs in the raw GitHub Actions runner.

---

## Infrastructure Files

| File | Purpose |
|---|---|
| `frontend/vitest.config.ts` | Configures `environment: jsdom`, `globals: true`, include/setup paths |
| `frontend/src/__tests__/setup.ts` | Imports `@testing-library/jest-dom` to add custom matchers |
| `frontend/tsconfig.json` | Excludes `src/__tests__/` from production TypeScript compilation |
| `.dockerignore` | Excludes `frontend/src/__tests__/` from the container image |

### Mock Strategy

| Dependency | Mock approach |
|---|---|
| `axios` | `vi.mock('axios')` — all methods auto-mocked; tests control resolved/rejected values per call |
| `react-i18next` | `useTranslation` returns `t: (key) => key` — translation keys appear as-is |
| `react-router-dom` | `useNavigate` replaced with `mockNavigate = vi.fn()` |
| `@/utils/timezone` | Replaced with stubs returning `'UTC'` and empty arrays |
| `@/utils/affiliate` | `LOOTBAR_URL` stubbed with a placeholder URL |

---

## Test Categories

### 1. AdminLogin Component (`frontend/src/__tests__/AdminLogin.test.tsx`)

| Test | Steps | Expected |
|---|---|---|
| `renders a password input and a submit button` | Render component | Password `<input>` and submit `<button>` are in the DOM |
| `shows an error message when the login API returns 401` | Stub reject, type wrong password, click submit | `"admin.invalidPassword"` text visible |
| `navigates to /admin/dashboard after a successful login` | Stub resolve with token, click submit | `mockNavigate` called with `'/admin/dashboard'` |
| `stores the token in localStorage after a successful login` | Same as above | `localStorage.getItem('adminToken') === 'admin-token'` |
| `disables the submit button while the request is in flight` | Stub never-resolving promise, click submit | Button has `disabled` attribute |

### 2. PlayerForm Component (`frontend/src/__tests__/PlayerForm.test.tsx`)

| Test | Steps | Expected |
|---|---|---|
| `renders the FID, game name and alliance inputs on step 1` | Render, wait for startup API calls | All three inputs visible |
| `shows an error when game_name is empty and Next is clicked` | Fill FID + alliance, click Next | `"form.required"` visible |
| `shows an error when FID is empty and Next is clicked` | Fill name + alliance, click Next | `"form.fidRequired"` visible |
| `shows an error when alliance is empty and Next is clicked` | Fill FID + name, click Next | `"form.allianceRequired"` visible |
| `advances to step 2 when all required fields are filled` | Fill all fields, click Next | Step-1 FID input gone |

---

## Extending the Suite

To add tests for a new component, create `frontend/src/__tests__/MyComponent.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import axios from 'axios'
import MyComponent from '@/pages/MyComponent'

vi.mock('axios')
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))

describe('MyComponent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders correctly', () => {
    render(<MemoryRouter><MyComponent /></MemoryRouter>)
    expect(screen.getByRole('heading')).toBeInTheDocument()
  })
})
```
