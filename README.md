# City Tree Care Collaboration

A focused full-stack starter for neighborhood tree stewardship: post a care request, browse the field board, and claim an open task as a volunteer.

## Stack

- Vite + React + TypeScript frontend
- Node.js + TypeScript HTTP API backend
- In-memory data with clean API boundaries for future persistence

## Run locally

```bash
npm install
npm run dev
```

The frontend runs at `http://localhost:5174` and proxies `/api` requests to the backend at `http://localhost:3002`.

Useful commands:

```bash
npm run dev:client      # frontend only
npm run dev:server      # backend only
npm run build           # frontend production build
npm run typecheck:server
```

## Extension points

- Add a map and geospatial tree records.
- Replace the in-memory request list with a database repository.
- Add volunteer accounts, recurring care events, photo evidence, and city arborist review.
- Introduce notifications for urgent requests and neighborhood care days.
