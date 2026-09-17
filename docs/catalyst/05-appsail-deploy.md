# AppSail — Docker deployment

HitList is deployed to AppSail as a Docker image, not as an AppSail managed
runtime bundle. `app-config.json` and `build:appsail` are intentionally absent.

Build an OCI Linux/amd64 image and publish it to a registry:

```bash
docker buildx build --platform linux/amd64 -t registry.example/hitlist:tag --push .
catalyst deploy appsail --name hitlist-api --source docker://registry.example/hitlist:tag --port 9000
```

The process selects its listening port from
`X_ZOHO_CATALYST_LISTEN_PORT` (then `PORT`), binds `0.0.0.0`, and provides
`/health`. Configure that path as the AppSail health check.

Do **not** configure `DATABASE_URL` in AppSail. Catalyst runtime signals select
Catalyst Data Store, and request-scoped gateway credentials preserve owner
isolation. The Docker image is also the local image, but outside Catalyst it
requires `DATABASE_URL` and uses PostgreSQL 9.5-compatible SQL.

For local containers, `compose.yaml` deliberately has no database service.
Point `DATABASE_URL` at the existing host database; Docker Desktop exposes it
as `host.docker.internal`.
