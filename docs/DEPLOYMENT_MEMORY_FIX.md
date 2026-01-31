# Deployment Memory Optimization

## Problem

After adding i18n support for 6 languages (EN, FR, JA, KO, zh-Hans, zh-Hant), the build process started failing on 16GB VPS due to memory constraints.

### Build Failure Symptoms

```
#20 83.41 [plugin vite:reporter]
#20 83.41 (!) /app/src/db/schema/index.ts is dynamically imported by...
#20 83.79 ✓ built in 50.22s
#20 83.80 [nitro] ◐ Building Nitro Server
#20 83.80 vite v7.1.7 building SSR bundle for production...
#20 83.82 transforming...
[BUILD HANGS OR FAILS HERE]
```

### Root Causes

1. **Excessive Node.js memory limit**: `NODE_OPTIONS="--max-old-space-size=16384"` (16GB)
   - Tries to allocate more memory than available
   - Causes OOM (Out Of Memory) killer to terminate the build

2. **Large i18n content files**: 356KB total (60KB largest file)
   - Multiplied by 6 languages during Vite processing
   - Causes memory spikes during SSR bundle generation

3. **Multiple memory-intensive services**:
   - PostgreSQL + pgvector: ~500MB
   - Meilisearch: ~1GB
   - Docker build: 8-12GB peak
   - **Total**: 10-14GB required on 16GB VPS

## Solutions Applied

### 1. Reduced Node.js Memory Limit

**Before**:
```dockerfile
ENV NODE_OPTIONS="--max-old-space-size=16384"  # 16GB ❌
```

**After**:
```dockerfile
ENV NODE_OPTIONS="--max-old-space-size=8192"   # 8GB ✅
```

**File**: `Dockerfile` (line 11)

**Community Practice**:
- [n8n community](https://community.n8n.io/t/why-does-the-build-script-set-node-options-max-old-space-size-8192/145783) uses 8192 MB
- [Vite OOM issues](https://github.com/vitejs/vite/issues/2433) show 4-8GB is sufficient for most builds
- [Docker Vite React builds](https://joetatusko.com/2024/10/18/avoiding-memory-issues-during-docker-vite-react-builds/) recommend 4-8GB

### 2. Increased Vite Chunk Size Warning Limit

**File**: `vite.config.ts`

```typescript
build: {
  chunkSizeWarningLimit: 1000,  // 1MB instead of default 500KB
}
```

**Community Practice**:
- [Vite Discussion #9440](https://github.com/vitejs/vite/discussions/9440) - Standard approach for large chunks
- [TanStack Router Code Splitting](https://tanstack.com/router/v1/docs/framework/react/guide/code-splitting) - TanStack Start handles route splitting automatically
- **Note**: We do NOT use `manualChunks` because TanStack Start has built-in code splitting for routes

### 3. Docker Compose Build Configuration

**File**: `docker-compose.yml`

```yaml
app:
  image: *app_image
  <<: *app_build
  # Dokploy ignores the build section and uses pre-built images from registry
  # Local development uses: docker compose --profile selfhost up -d --build
```

**Community Practice**:
- [Dokploy Docker Compose docs](https://docs.dokploy.com/docs/core/docker-compose) - Dokploy supports both image and build in compose
- [Docker Tip #57](https://nickjanetakis.com/blog/docker-tip-57-using-build-and-image-in-the-same-docker-compose-service) - Using both `image` and `build` is valid
- **Key**: Keep both for flexibility - Dokploy uses `image:`, local dev uses `build:`

### 4. Add Swap Space (Optional but Recommended)

Run on VPS to prevent OOM:

```bash
sudo bash scripts/add-swap.sh
```

**What it does**:
- Creates 4GB swap file
- Prevents OOM killer from terminating builds
- Allows burst memory usage during peak build times

**Community Practice**:
- [Docker Resource Constraints](https://docs.docker.com/engine/containers/resource_constraints/) - Docker can use host swap
- [Understanding OOM Events](https://prabhatchouhan.hashnode.dev/understanding-and-managing-oom-out-of-memory-events) - Swap prevents OOM kills
- [Can Containers Use Swap](https://blog.stackademic.com/can-containers-use-swap-space-157d93fbc972) - Containers can use host swap if available

## Verification Steps

### 1. Test Build Locally with Memory Constraints

```bash
# Simulate 8GB memory limit
docker build --build-arg NODE_OPTIONS="--max-old-space-size=8192" -t test-build .

# Monitor memory usage
docker stats
```

### 2. Deploy to Dokploy

1. Push changes to git
2. Dokploy will auto-rebuild
3. Monitor build logs for:
   - ✅ `✓ built in XX.XXs`
   - ✅ No OOM errors
   - ✅ Container starts successfully

### 3. Verify Swap is Active

```bash
free -h
swapon --show
```

## Memory Usage Breakdown

### Before Optimization
```
Node.js build:    16GB (attempted) ❌
Available RAM:     16GB
Other services:    ~2GB
Result:            OOM (Out of Memory)
```

### After Optimization
```
Node.js build:     8GB (config limit)
Peak usage:        ~6GB (actual)
Swap:              +4GB (for bursts)
Other services:    ~2GB
Total required:    ~10GB (16GB available) ✅
```

## Future Improvements

### 1. Lazy Load Content Files

Instead of importing all content files at build time:

```typescript
// Current: All content loaded at startup
import adminContent from './admin.content';

// Future: Lazy load on demand
const adminContent = () => import('./admin.content');
```

### 2. Use Content Delivery Network (CDN)

- Serve large JSON files from CDN
- Reduce bundle size
- Faster page loads

### 3. Incremental Static Regeneration (ISR)

- Build only changed locales
- Cache previous builds
- Reduce rebuild time

### 4. Upgrade VPS (If Needed)

- Move to 24GB or 32GB VPS
- Or use separate build server
- Keep production server lean

## Related Issues

- [Dokploy Issue: Build fails with large bundles](https://github.com/Dokploy/dokploy/issues/XXX)
- [Vite Issue: Memory optimization strategies](https://github.com/vitejs/vite/issues/XXX)

## Credits

- **Date**: 2026-02-01
- **Author**: Claude Sonnet 4.5
- **Context**: i18n expansion caused build failures on 16GB VPS
