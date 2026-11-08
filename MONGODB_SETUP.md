# BillFlow MongoDB developer setup

BillFlow's application persistence uses MongoDB only. The application uses the official MongoDB Node.js driver and the `MONGODB_URI` environment variable. `MONGODB_DATABASE` optionally selects the database name and defaults to `billflow`.

## Local development

1. Install MongoDB Community Server and `mongosh`. From the project root, start a local replica set (in one terminal):

   ```sh
   mkdir -p data/mongodb
   mongod --dbpath ./data/mongodb --replSet rs0 --bind_ip 127.0.0.1 --port 27017
   ```

   In another terminal, initialize the replica set once:

   ```sh
   mongosh "mongodb://127.0.0.1:27017/admin" --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
   ```

   `data/mongodb/` is git-ignored. Transactions require a replica set or sharded cluster; standalone `mongod` is not sufficient.
2. Copy `.env.example` to `.env` and use its local-only `mongodb://127.0.0.1:27017/billflow?replicaSet=rs0` placeholder. Do not commit `.env` or replace the placeholder with a real URI in source control.
3. Install dependencies with `pnpm install`, then run `pnpm check`, `pnpm test`, and `pnpm dev`.
4. On first successful connection, BillFlow creates its collections' indexes. A new MongoDB database starts empty and users create their workspace through the existing sign-up flow.

## Deployment handoff

Set `MONGODB_URI` as a protected runtime secret in the development or production environment chosen by the project owner. Configure network access and TLS according to the MongoDB provider. Do not paste the credential into source files, `.env.example`, logs, tickets, or chat. If deployment runs in a separate network from local development, use separate development and production MongoDB databases or clusters.

## Data and operations

All business records remain company-scoped. Collection names retain the `bf_` prefix for clarity. Numeric `id` fields are allocated from a MongoDB sequence collection to preserve the existing API/UI identifiers; MongoDB's `_id` remains an internal storage key. Ensure compound unique indexes for tenant-scoped numbering and head names remain enabled.

Transactions protect multi-document changes such as document/counter creation, payment status updates, and the Admin-only business-data reset. Never run the destructive reset as part of development setup or tests. Do not place real customer or company data into synthetic tests.
