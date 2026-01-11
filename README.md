# AI Plan My Trip Now

![AI Plan My Trip Now UI](https://i.imgur.com/S59iMfy.png)

AI Plan My Trip Now is a hackathon MVP that lets you type a trip request, generates a multi‑step plan with multiple agents, and shows user‑facing results (dates, flights, hotels, transport, activities, and a final itinerary) in a dashboard.

## What’s In This Repo

**Backend (`src/server.ts`)**
- Express API on `http://localhost:3000`
- Long‑running workflow engine that persists state to MongoDB (`workflows` + `steps`)
- LLM planning: `POST /api/workflows` uses OpenAI (`gpt-5-nano`) to produce a list of steps + assigned agents

**Frontend (`client/`)**
- Vite + React + Tailwind dashboard on `http://localhost:5173`
- Shows “Recent Missions”, current running task, and step outputs
- Includes a “Clear” button to delete all workflows/steps

## MongoDB Atlas Usage (Meaningful)

This project uses Atlas for more than just persistence:

1) **Atlas Vector Search** (grounding / “travel notes” retrieval)
- Collection: `knowledge_chunks`
- Field: `embedding` (OpenAI embeddings)
- Endpoint: `GET /api/knowledge/search?q=...&destination=...`
- Planner (`POST /api/workflows`) pulls relevant notes and injects them into the planning prompt.

2) **Time‑series collection** (price trend → date selection)
- Collection: `price_samples` (time‑series when privileges allow, regular collection fallback)
- Used by the engine to pick dates and show a weekly price trend (seeded with synthetic samples if empty).

## Setup

### 1) Environment

Create a `.env` in the repo root:
```bash
MONGODB_URI=mongodb+srv://...
OPENAI_API_KEY=sk-...

# Optional (defaults shown)
EMBEDDING_MODEL=text-embedding-3-small
ATLAS_VECTOR_INDEX=knowledge_embedding
```

### 2) Install + Run

Terminal 1 (backend):
```bash
npm install
npm start
```

Terminal 2 (frontend):
```bash
cd client
npm install
npm run dev
```

Open `http://localhost:5173`.

## Atlas Setup (Vector Search)

Create a **Vector Search** index on the `knowledge_chunks` collection (not on `steps` or `workflows`).

- Index name: `knowledge_embedding` (or set `ATLAS_VECTOR_INDEX`)
- Vector field: `embedding`
- Dimensions: `1536` (for `text-embedding-3-small`)
- Similarity: `cosine`

Example JSON (Atlas UI → JSON editor):
```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 1536,
      "similarity": "cosine"
    },
    { "type": "filter", "path": "tags.destination" },
    { "type": "filter", "path": "tags.topic" }
  ]
}
```

After the index is ready, seed the knowledge base (requires `OPENAI_API_KEY`):
```bash
npm run seed:knowledge
```

## Demo Tips

- Use the UI to create a mission, then watch each step fill in user‑facing data.
- Use the sidebar “Clear” button if you want to wipe the mission history.
- Optional “sleeping agent” demo (creates `WAIT:` steps): `./demo.sh`

## Notes / Limitations

- Flight/hotel/transport/activity results are **mocked** (designed for an MVP UI), while planning + embeddings use OpenAI.
- Time‑series price data is seeded synthetically when missing (so the “price trend” UI has something to show).

---
Built for the MongoDB SF Hackathon 2026
