# Traefik dynamic config (Path A) — optional, for the **Cloudflare Origin CA** TLS option

`docker-compose.prod.yml` mounts this directory into Traefik as a **file provider**
(`/etc/traefik/dynamic`). By default it's empty of `*.yml`, so Traefik uses the
**Let's Encrypt DNS-01** resolver (the compose default) and nothing here is active.

To switch to the **Cloudflare Origin CA** option instead (domain on Cloudflare, orange-cloud
proxied, Full(Strict)) — the approach proven on the Dokploy path:

1. Create an Origin CA cert in Cloudflare (Zone → SSL/TLS → Origin Server) covering
   `your-domain` **and** `*.your-domain`. Save the cert + key here as:
   - `infra/prod/dynamic/origin.crt`
   - `infra/prod/dynamic/origin.key`   (gitignored — it's a private key; never commit it)
2. `cp origin-ca.yml.example origin-ca.yml` (Traefik loads `*.yml` from here automatically).
3. In `docker-compose.prod.yml`, on the **app** service labels, remove the three
   `...tls.certresolver=le` / `...tls.domains[0]...` lines from the `main` router (the routers
   keep `tls=true` and will serve this default cert). You can also drop the
   `--certificatesresolvers.le...` flags + `CF_DNS_API_TOKEN` from the `traefik` service.
4. Set Cloudflare DNS: `A @ → <vps-ip>` and `A * → <vps-ip>` (or CNAMEs), both **proxied**.

That's it — Traefik serves the Origin CA cert as the default for the apex + all preview
subdomains, and Cloudflare terminates the public TLS at its edge (Full(Strict) to your origin).
