# BillFlow

React / Express / tRPC / MongoDB billing application.

- `pnpm dev`: development server; honors `PORT` (default 3000).
- `pnpm build` / `pnpm start`: build and serve `dist/index.js` and `dist/public/`.
- `pnpm check` / `pnpm test`: types and application tests.

BillFlow uses local email/password authentication, MongoDB for persistence, Cloudflare R2 for private document assets, and SMTP for email delivery. Configure these services through `.env`; never commit credentials.

## Production deployment

Build and run the container:

```sh
docker build -t billflow .
docker run --env-file .env -p 3000:3000 billflow
```

Set `NODE_ENV=production`, `MONGODB_URI`, and `MONGODB_DATABASE` in the deployment secret manager. The MongoDB deployment must support transactions. Configure the `R2_*` variables for logos and letterheads and the `SMTP_*` variables for email delivery. Use an external scheduler to call `POST /api/scheduled/daily-invoices` with `Authorization: Bearer <SCHEDULED_JOB_TOKEN>`; keep `ENABLE_INTERNAL_SCHEDULER=false` when running multiple instances.

The container exposes port `3000` and reports readiness through `GET /api/health`. Environment files are excluded from the Docker build context.
