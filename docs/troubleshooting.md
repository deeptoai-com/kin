# Troubleshooting

Common issues and solutions.

## Development

### Page Keeps Loading / HeadersTimeoutError

**Symptom**: Browser shows loading spinner, never finishes. Backend logs show `HeadersTimeoutError` or `UND_ERR_HEADERS_TIMEOUT`.

**Cause**: In `pnpm dev`, Nitro uses a Vite worker that forwards requests via `fetch()`. Slow SSR or cold start can trigger undici's headers timeout.

**Solution**: Use the production build instead:

```bash
NODE_OPTIONS="--max-old-space-size=8192" VITE_WS_URL="ws://localhost:3001/ws/agent" pnpm build
pnpm start:hybrid
```

`start:hybrid` runs Nitro directly (no worker/fetch), so the timeout does not occur.

---

### Build Fails with "JavaScript heap out of memory"

**Symptom**: Build crashes during SSR bundle step with `FATAL ERROR: ... Allocation failed - JavaScript heap out of memory`.

**Solution**: Increase Node's heap size:

```bash
NODE_OPTIONS="--max-old-space-size=8192" pnpm build
```

---

### DATABASE_URL is not defined

**Symptom**: `Error: DATABASE_URL is not defined` when running `pnpm start` or `pnpm start:hybrid`.

**Solution**:
1. Ensure `.env` exists and contains `DATABASE_URL`
2. `start-production.mjs` loads `.env` via `dotenv/config`; ensure the file is in the project root
3. If using Docker infra + local app, set `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/oxygenie"` (or match your POSTGRES_* values)

---

### Redis / Meilisearch Connection Refused

**Symptom**: App or worker cannot connect to Redis or Meilisearch when running locally.

**Solution**: Ensure `docker-compose.yml` exposes ports for hybrid mode:

- Redis: `ports: ['6379:6379']`
- Meilisearch: `ports: ['7700:7700']`

Then set in `.env`:
- `REDIS_URL="redis://localhost:6379"`
- `MEILI_HOST="http://localhost:7700"`

---

## Docker

### database "oxygenie" does not exist

**Solution**: The stack runs a `create-db` step. If it fails, reset volumes and redeploy:

```bash
docker compose --profile selfhost down -v   # ⚠️ Deletes all data!
pnpm docker:up
```

**Warning**: `down -v` removes volumes and deletes data.

---

### Keeping Existing DB Data (ex0/constructa)

If you have existing data, **do not** run `down -v`. In `.env`, set only:

```
POSTGRES_USER="postgres"
POSTGRES_PASSWORD="postgres"
POSTGRES_DB="constructa"   # or ex0, match your existing DB name
```

Do **not** set `DATABASE_URL` when using Docker; it is built from `POSTGRES_*` with host `db`.
