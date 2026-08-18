# RideMesh — Multi-Tenant Real-Time Rider Tracking & Social Riding Platform

A production-oriented multi-tenant SaaS rewrite of RideMesh. Every organization gets
isolated users, riders, friends, trips, chats, and notifications; a platform-level
**Super Admin** creates and manages organizations; each organization's own **Org Admin**
manages only their own org. All RideMesh features (accounts, private phone numbers, live
GPS tracking, friends, 1:1 chat, trips with leader/invite/live-tracking/group-chat/history,
notifications) are preserved and now tenant-scoped. Monetization is fully wired into the
schema and backend but **disabled** — every org/user currently has full access to every
feature.

```
rider-platform/
├── backend/     Node.js + Express + Socket.IO + PostgreSQL API and WebSocket server
├── frontend/    Vanilla JS + Leaflet: rider dashboard, org-admin panel, super-admin panel
└── deploy/      Nginx config, PM2 config, VPS provisioning script, backup script
```

## Roles

- **super_admin** — platform owner (you). `org_id` is NULL. Creates/activates/deactivates
  organizations, creates or promotes org admins, searches users platform-wide, views the
  audit log, manages plans (dormant). Logs in at `index.html` → "Super Admin" link, or
  directly via `POST /api/auth/super-admin/login`.
- **org_admin** — manages only their own organization: users, trips, live riders, account
  recovery. Cannot see or touch another org's data — enforced server-side, not just hidden
  in the UI (see Testing below).
- **member** — a normal rider. Full RideMesh feature set, scoped to their org.

## Quick start (local development)

### 1. PostgreSQL

```bash
sudo -u postgres psql -c "CREATE DATABASE ridemesh;"
sudo -u postgres psql -c "CREATE USER ridemesh_app WITH PASSWORD 'devpassword';"
sudo -u postgres psql -d ridemesh -c "GRANT ALL PRIVILEGES ON DATABASE ridemesh TO ridemesh_app;"
```

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env      # set DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
node db/migrate.js         # applies schema + seeds the "launch" unrestricted plan
npm start                  # runs on 127.0.0.1:4000
```

Create the platform Super Admin:

```bash
node scripts/create-super-admin.js superadmin "Your Name" "+10000000000" you@example.com "a-strong-password"
```

### 3. Frontend

Static files, no build step:

```bash
cd frontend
npx serve .
```

Edit `frontend/js/config.js` to point at your backend if not on `localhost:4000`.

### 4. First-run workflow

1. Log in as Super Admin (`index.html` → "Super Admin" link) → **Organizations** →
   create an organization (e.g. name "Coimbatore Riders", code `coimbatore-riders`).
2. On that organization's detail panel, create an **Organization Admin** and share the
   org code + temporary password with them directly (never sent by SMS/email/API).
3. Riders register at `index.html` with that org code — they land as `member`.
4. The org admin logs in with the same org code at `org-admin.html` and manages their
   organization: disable/enable accounts, reset passwords, manage trips, watch live riders.

## What's implemented and tested (not just written)

Every item below was exercised against a real PostgreSQL instance with live HTTP requests,
not just reasoned about:

- **Tenant isolation**: a member in Org A gets an empty search result, a 404, and a
  rejected friend request when targeting a user in Org B — confirmed live.
- **Org-admin scoping**: an org admin passing a *different* org's ID in the request is
  silently ignored server-side; they only ever operate on their own `org_id` from the
  verified access token, never from client input.
- **Refresh token rotation + theft detection**: rotating a refresh token invalidates the
  old one; *reusing* an already-rotated token is detected and revokes the entire token
  chain for that user, forcing re-login — confirmed live.
- **Immediate lockout on org disable**: deactivating an organization invalidates its
  members' *already-issued, unexpired* access tokens on their very next request, not just
  future logins — confirmed live.
- **Profile picture upload**: multer + sharp validate, resize to 512×512, strip EXIF, and
  store outside the web root; serving requires auth and is denied across organizations —
  confirmed live.
- **Phone-number privacy**: unchanged rule, now re-verified under multi-tenancy — hidden
  until friendship is accepted, enforced through a single `serializeUser()` chokepoint.
- **Audit logging**: every super-admin/org-admin action (org create/activate/deactivate,
  admin create/promote, user disable/enable/reset/delete, trip cancel/delete) is recorded.
- **Security middleware**: Helmet headers, strict CORS allow-list, rate limiting on
  auth/recovery endpoints, express-validator on registration, request size limits — all
  confirmed present and functioning.
- Friends, 1:1 chat, and the full trip lifecycle (create → invite → accept → live
  tracking → group chat → complete → history) were re-run end-to-end on the new stack.

## What's NOT done / needs your attention before real production traffic

- **Frontend was not tested in an actual browser** in this environment (no headless
  browser available) — I verified it by syntax-checking every JS file and cross-checking
  every `getElementById` call against every HTML file's actual IDs (all matched, zero
  mismatches) and by confirming every API path the frontend calls exists on the backend.
  That is real verification, but it is not the same as clicking through it. Please do that
  before relying on it.
- **Socket reconnection on token expiry** is implemented (the client detects an auth error
  and retries after a refresh), but wasn't exercised against a real 15-minute expiry window
  in testing — only logically reviewed.
- **PM2 is configured for a single instance.** Socket.IO's default in-memory adapter does
  not fan out events across multiple Node processes/servers. If you need to scale past one
  instance, add `@socket.io/redis-adapter` first.
- **SMS and email are stub integrations** (`utils/sms.js`, `utils/email.js`) that log
  instead of sending. Wire a real provider before relying on self-service recovery or
  admin SMS notifications in production.
- **The "impersonate/support an org admin" mechanism** mentioned as a nice-to-have was not
  built — Super Admin currently manages orgs directly rather than borrowing an org admin's
  session. Worth adding an explicitly-audited version of this if you need it later.
- No automated test suite — everything above was verified with manual curl-based
  integration tests during this build, not a repeatable CI suite.

## Deployment to track.zeekerstech.com

See `deploy/`:
- `nginx-track.zeekerstech.com.conf` — HTTPS termination, static frontend, `/api` and
  `/socket.io` reverse proxy with WebSocket upgrade support.
- `ecosystem.config.js` (in `backend/`) — PM2 process config.
- `provision-vps.sh` — one-time VPS setup (firewall, Postgres, Node, Nginx, PM2); review
  before running, it prints manual steps for DNS/SSL/passwords rather than blindly
  executing them.
- `backup-postgres.sh` — cron-driven `pg_dump` backups with retention + restore
  instructions; **copy `BACKUP_DIR` off-box** for real disaster recovery.

The Node app binds to `127.0.0.1:4000` only (see `HOST` in `.env`) and PostgreSQL binds to
localhost by default — neither is exposed to the internet; Nginx is the only public entry
point, per the requirements.

## Activating monetization later

The schema (`plans`, `subscriptions`, `user_entitlement_overrides`, `billing_records`) and
the enforcement seam (`utils/entitlements.js`) already exist. To activate:

1. Set `MONETIZATION_ENABLED=true` in `.env`.
2. Call `requireFeature('feature_key')` as middleware on routes that should be gated (the
   hook is already there; it currently no-ops).
3. Use the Super Admin panel's Plans section to configure real plans, then assign them to
   organizations via `POST /api/super-admin/organizations/:id/subscription`, or override
   individual users via `POST /api/super-admin/users/:id/entitlement-override`.
4. Wire a real payment gateway (Razorpay, etc.) as a separate service that writes to
   `billing_records` via webhook — no schema changes required.

No core architecture changes are needed to turn this on.

