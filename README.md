# CityLens AI

CityLens AI contains a React/TypeScript/Vite frontend and a FastAPI service backed by PostgreSQL and SQLAlchemy 2.x. Authentication uses the existing Argon2 password hashes and opaque, server-managed sessions. Operational records are persisted for defects, observations, evidence metadata, repair assignments, traffic incidents, police alerts, and audit activity. Charts and workflows without connected operations remain labelled as demo data.

## Local setup

Copy `.env.example` to `.env` and replace every `REPLACE_WITH_...` value with private local values. Set the same strong database password in `DATABASE_URL` and `POSTGRES_PASSWORD`, and set a private `ADMIN_BOOTSTRAP_PASSWORD` of at least 12 characters. `.env` is ignored by Git; never commit credentials.

Create the backend environment and install its dependencies:

```powershell
py -3.14 -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -e "backend[dev]"
```

### PostgreSQL, migrations, and first administrator

Start PostgreSQL with Docker Compose, apply the Alembic migrations, and create the first administrator:

```powershell
Copy-Item .env.example .env
# Edit .env and replace the placeholders before continuing.
docker compose up -d postgres
backend\.venv\Scripts\python.exe -m alembic -c backend\alembic.ini upgrade head
backend\.venv\Scripts\python.exe -m app.seed_admin
```

`DATABASE_URL` must use the `postgresql+psycopg://` scheme. URL-encode reserved characters in the database password when placing it in the URL. The seed command only runs with `APP_ENV=development`, requires the bootstrap values from `.env`, and refuses to overwrite an existing account. Resident self-registration is available only after SMTP delivery has been configured. Resident accounts are created inactive, must verify their email, and receive read-only access to reviewed road defects. To create a database without Docker, create a PostgreSQL database and user with privileges on that database, then set `DATABASE_URL` in `.env` to their connection URL before applying migrations.

If development login returns `Invalid email or password`, check that the API is connected to the intended database and that the account exists and is active. To create the configured development administrator, set `ADMIN_BOOTSTRAP_EMAIL` and a private `ADMIN_BOOTSTRAP_PASSWORD` (at least 12 characters) in the root `.env`, then run `backend\.venv\Scripts\python.exe -m app.seed_admin` from the repository root. This development-only command uses the CityLens password hasher and is safe to rerun: it does not change an existing account or its password. Never run it outside `APP_ENV=development`; use an administrator-provisioned account for other environments.

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL printed in the terminal, usually `http://127.0.0.1:5173`, and sign in with the administrator account you seeded. The UI uses an HTTP-only session cookie and the backend's role; it does not store credentials or select a role in the browser. Road video intake is available to municipal engineers and admins when a compatible model is configured. Map markers require actual report coordinates, and police alerts are never sent.

### Backend

In another terminal from the repository root:

```powershell
backend\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload
```

The API exposes `/health`, `/api/v1/health`, `/api/v1/ready`, the existing `/api/v1/auth/*` routes, and the operational routes under `/api/*` (also available under `/api/v1/*` for the existing frontend proxy). Interactive API documentation is at `http://127.0.0.1:8000/docs`. Sessions are random opaque tokens; only SHA-256 token hashes are stored in PostgreSQL. Cookies are HTTP-only, SameSite Lax, scoped to `/api`, and Secure outside development/test.

Operational routes include paginated/filterable defects, repairs, incidents, alerts, and recent activity; dashboard summary counts; map-ready defects; and protected evidence metadata/downloads. Municipal engineers and admins review defects and assign active maintenance users. Traffic controllers and admins review incidents before authorizing an alert. Maintenance users can update only their assigned repair work and upload evidence for that defect. Police users can view only alerts assigned to them and update the investigation status. Alert authorization records an internal CityLens alert; it does not transmit messages to external police systems. Evidence uploads are content-type/signature checked, size limited, saved with generated names outside static directories, and accessible only under authenticated role rules.

The backend also accepts the legacy `POSTGRES_*` settings when `DATABASE_URL` is not set, to retain compatibility with existing local environments. `DATABASE_URL` is the recommended setting.

### Public accounts and role-based user management

Public users register with name, email, and a strong password; the server assigns the `Public User` role, hashes the password, and requires the existing time-limited email verification flow. Registration rejects extra role fields. The login screen provides Create Account, Forgot Password, and Reset Password flows. Password reset links use a single-use hashed token, expire after `PASSWORD_RESET_TTL_MINUTES` (15 by default), and invalidate existing sessions after a successful reset. Reset requests are rate limited to 3 per email address and 5 per client IP per hour; requests return a generic response to prevent account enumeration. Reset and verification emails use the existing SMTP settings and the configured `PUBLIC_APP_URL`. Public users can create and track only their own reports, attach photographs, edit or withdraw reports awaiting review, and access a sanitized list of reviewed public defects. Report evidence is private and protected by the same authenticated API. Status updates appear in the user's report list when refreshed; outbound report-status notification delivery is not implemented.

The Admin-only User Management page supports paginated search/filtering, profile and role edits, activation/deactivation, and confirmed account deletion. Deletion is a soft delete: sign-in is disabled, active sessions are revoked, and report ownership and audit history are retained. The active administrator cannot delete their own account; the backend also protects the last active administrator. The API checks authorization independently of frontend visibility. The supported roles are Admin, Municipal Engineer, Traffic Controller, Police Officer, Maintenance Team, and Public User.

Apply the additive role/account migration with `backend\\.venv\\Scripts\\python.exe -m alembic -c backend\\alembic.ini upgrade head`; it renames existing Resident/Police Team role values without dropping accounts and adds soft-delete metadata plus withdrawn-report status. Application configuration and SMTP secrets remain environment-managed (not editable through the web UI or returned by APIs); edit local `.env` with administrator-level file access. The system-wide audit activity endpoint is Admin-only.

### Road-damage video detection

Video detection is optional and remains unavailable unless the backend has both the optional AI dependencies and a local model file whose actual class names include supported road-damage labels. Configure `ROAD_DAMAGE_MODEL_PATH` in `.env` to the absolute path of a road-damage model you have obtained and evaluated. Supported model labels are `pothole`, `crack`, `longitudinal crack`, `transverse crack`, `alligator crack`, `rutting`, and the RDD labels `D00`, `D10`, `D20`, `D40`. Generic object-detection weights without one of these labels are rejected. The API reads the model's own class names before enabling uploads; it does not download or silently substitute weights.

To install the optional Python packages, use:

```powershell
backend\.venv\Scripts\python.exe -m pip install -e "backend[ai]"
```

Ultralytics may install PyTorch and related packages, which can require several gigabytes of downloads and disk space. Check the package and hardware requirements first, and choose the CPU or CUDA-compatible PyTorch environment appropriate for your machine. OpenCV video support depends on the codecs enabled in the installed build; videos with unsupported codecs fail with a visible job error. The current workspace has no model weights or sample videos, and these packages have not been installed here, so real inference has not been verified.

Video uploads are limited to 500 MiB by default, stored privately under `var/road-videos`, and sampled once per second by default. Set `ROAD_VIDEO_MAX_UPLOAD_BYTES`, `ROAD_VIDEO_MAX_DURATION_SECONDS`, and `ROAD_DAMAGE_SAMPLE_INTERVAL_SECONDS` as needed. Optional location is accepted only as latitude/longitude explicitly verified by an engineer, or from a JSON sidecar such as `{"latitude": 45.5, "longitude": -73.6}`. No location is inferred when neither source is available. Engineers review each genuine model detection before it becomes an official road-defect report. Apply the additive schema migration with the normal `alembic upgrade head` command before using the new endpoints.

### Without Docker

If Docker is unavailable, install or use a PostgreSQL server and set `DATABASE_URL` in `.env`. The API authentication and operational endpoints require a reachable database. The automated tests use a temporary SQLite database and do not need Docker or production credentials.

## Checks

```powershell
cd frontend
$env:VITE_API_URL = "https://api.example.invalid/api/v1"
npm run build
cd ..
backend\.venv\Scripts\python.exe -m pytest backend\tests
```

Use a placeholder HTTPS API URL only for a local production-build check; replace it with the real Render custom domain in Vercel before deployment.

## Authentication status

Authentication implemented: Argon2 password hashes, unique PostgreSQL user email, validated roles, active-account status, server-side sessions, logout/revocation, session expiry, admin-only user create/list/update, frontend protected routes, role-filtered navigation, and expiry handling. Domain APIs enforce role permissions on the server and write operational changes to the audit log.

Role access is enforced by API dependencies for authentication, administration, and domain actions as well as by the frontend for existing UI routes. Live dashboard summary and recent defect/incident tables use API responses when available; demo charts and unsupported workflows remain visibly labelled.

Leaflet, React-Leaflet, Recharts, and Lucide React are installed for the frontend. The YOLO/OpenCV integration is implemented as an optional capability; it reports unavailable until the dependencies and a compatible model are configured.

## Production deployment: Vercel, Render, and Neon

### Deployment audit and known limits

- The frontend now reads `VITE_API_URL`; production builds require an HTTPS URL ending in `/api/v1`. The Vite `127.0.0.1` proxy is development-only.
- Authentication uses HTTP-only opaque session cookies, not JWTs. Production cookies are Secure and SameSite=None for cross-origin HTTPS requests. For reliable Safari/iOS and privacy-restricted browser behavior, use custom sibling domains under the same registrable domain, for example `app.<your-domain>` on Vercel and `api.<your-domain>` on Render. The default `*.vercel.app` to `*.onrender.com` pairing is cross-site and may be blocked by browser third-party-cookie protections.
- CORS permits only exact origins listed in `FRONTEND_ORIGINS`; production startup rejects wildcard, non-HTTPS, or non-origin entries. Do not include paths or a trailing slash in this comma-separated value. `PUBLIC_APP_URL` must be the exact public frontend URL used in verification and password-reset links.
- The runtime accepts Neon `postgresql://`/`postgres://` URLs and selects the installed psycopg v3 driver. Use Neon’s pooled endpoint and `sslmode=require`. The Render pre-deploy command applies additive Alembic migrations; it does not drop/reset tables. Back up an existing database before the first deployment and verify its migration revision before upgrading.
- Evidence and video files are stored privately on a Render persistent disk mounted at `/var/data`. The Blueprint reserves 10 GB; it is paid storage, single-instance, and does not scale across multiple backend instances. Monitor capacity and configure a retention/backup process before accepting large volumes.
- OpenCV and Ultralytics are optional extras and are deliberately not installed by the normal Render build. No compatible road-damage model is configured in this workspace. Consequently video detection remains unavailable on the deployed web service until the model/dependencies are provisioned.
- Video inference currently uses FastAPI in-process background tasks and local file paths. This is not a durable queue: a restart can interrupt a job, and a separate worker needs shared/object storage to scale safely. Do not claim production-grade AI processing until a separate queue/worker, persistent shared media, resource sizing, and model inference tests are implemented.
- Staff accounts cannot be created through public registration. The one-time production bootstrap CLI below is available only when no active Admin exists; it refuses to overwrite accounts and hashes the temporary password.

### Prepare Neon

1. Create a Neon project/database in a region near the Render service. If migrating existing data, take and verify a backup first; do not point production at a database you intend to reset.
2. Copy the **pooled** connection string from Neon. In Render, set `DATABASE_URL` to the same URL using the `postgresql+psycopg://` scheme and retain `?sslmode=require` (URL-encode reserved characters in credentials). Never put this URL in Vercel or frontend variables.
3. The Render Blueprint runs `python -m alembic -c alembic.ini upgrade head` as its pre-deploy command. For a manual migration instead, use the same command from the `backend` directory after setting `DATABASE_URL`. Confirm `/ready` returns 200 after migration. The app’s readiness endpoint checks `SELECT 1`; it does not modify data.

### Configure Render

1. Push this repository to a private or public Git provider of your choice and create a Render Blueprint from its root `render.yaml`. The service uses `backend` as its root, installs the production dependencies from `backend/requirements.txt` with `pip install -r requirements.txt`, binds to Render’s `$PORT`, and checks `/ready`.
2. Configure every Blueprint prompt marked `sync: false` in the Render service dashboard. Required core values:
   - `DATABASE_URL`: Neon pooled URL.
   - `FRONTEND_ORIGINS`: exact Vercel custom frontend origin, e.g. `https://app.<your-domain>`; include another exact HTTPS origin only if you intentionally use it.
   - `PUBLIC_APP_URL`: that same frontend origin (no trailing slash).
   - SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, with one secure transport (`SMTP_USE_STARTTLS=true` or `SMTP_USE_SSL=true`) for registration verification and password resets.
3. Set up your Render custom API domain before production login testing. Use the resulting HTTPS API URL for Vercel’s `VITE_API_URL` as `https://api.<your-domain>/api/v1`. The exact host is supplied by your DNS/Render configuration; this repository does not assume or invent one.
4. For a new database with no administrator, temporarily set `APP_ENV=production`, `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD` (strong, at least 12 characters), and optionally `ADMIN_BOOTSTRAP_NAME` in the Render service environment. In the Render Shell, from the backend root, run `python -m app.bootstrap_admin`. Confirm the command succeeds, then remove the temporary email/password variables immediately and redeploy. It refuses to run outside production/staging, if an active Admin exists, or if that email already belongs to an account.
5. Keep `ROAD_DAMAGE_MODEL_PATH` unset until the model is deliberately installed. Do not add a model weight file to Git. Normal API startup does not download weights or enable generic-object inference.

### Configure Vercel

1. Import the repository into Vercel and set the project Root Directory to `frontend`. Use the Vite framework preset, build command `npm run build`, and output directory `dist`. `frontend/vercel.json` supplies client-side route rewrites.
2. Add the Vercel custom frontend domain, then set the production environment variable `VITE_API_URL` to the HTTPS Render custom API URL ending in `/api/v1`. Set it for Preview only when the preview origin is also explicitly listed in Render’s `FRONTEND_ORIGINS`; avoid broad wildcard CORS.
3. Redeploy after setting/changing `VITE_API_URL`; Vite embeds it at build time. The backend URL and all SMTP/database/bootstrap credentials must remain out of frontend environment variables.

### Production deployment checklist

- [ ] Confirm the Render service starts with `APP_ENV=production`, exact HTTPS `FRONTEND_ORIGINS`, `DATABASE_URL`, and HTTPS `PUBLIC_APP_URL`.
- [ ] Confirm `/health` returns 200 and `/ready` returns 200; confirm the Neon Alembic revision is at `head`.
- [ ] Confirm the Vercel build has `VITE_API_URL`, and test login/logout and session refresh on Android and iOS Safari/Chrome using the custom sibling domains.
- [ ] Confirm requests from an unlisted origin are rejected, unauthenticated operations still return 401, and role-restricted actions remain server-enforced.
- [ ] Test public registration, verification email, forgot/reset email, duplicate addresses, and rate limits with real SMTP only after deployment. No real delivery is asserted by local tests.
- [ ] Upload evidence, redeploy/restart the Render service, and verify authorized evidence remains available while unauthorized accounts still receive 403.
- [ ] Set operational disk usage alerts, database backup/restore policy, log retention, rate monitoring, and an upload cleanup policy.
- [ ] Do not enable public road-video processing until upload size/time limits, persistent storage capacity, compatible model provenance/classes, CPU/RAM budget, timeout behavior, and a separate durable worker/queue have been verified.