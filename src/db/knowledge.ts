import { OpenAI } from 'openai';
import mongoose from 'mongoose';
import { KnowledgeChunk } from './schema';

export type KnowledgeResult = {
    text: string;
    source: string;
    tags?: {
        destination?: string;
        topic?: string;
    };
    score?: number;
};

async function embedText(text: string) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is missing');
    const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const resp = await openai.embeddings.create({ model, input: text });
    const vector = resp.data[0]?.embedding;
    if (!vector || !Array.isArray(vector)) throw new Error('Failed to generate embedding');
    return vector;
}

export async function addKnowledgeChunk(params: {
    text: string;
    source: string;
    tags?: { destination?: string; topic?: string };
}) {
    const embedding = await embedText(params.text);
    return KnowledgeChunk.create({
        text: params.text,
        source: params.source,
        tags: params.tags ?? {},
        embedding,
    });
}

export async function seedKnowledgeChunks() {
    const samples: Array<{ text: string; source: string; tags: { destination?: string; topic?: string } }> = [
        {
            source: 'Curated: Tokyo starter pack',
            tags: { destination: 'Japan', topic: 'itinerary' },
            text: [
                'Tokyo: cluster activities by neighborhood to reduce transit time.',
                'Shinjuku/Shibuya for nightlife; Asakusa for traditional sights; Tsukiji for food.',
                'Day trip ideas: Hakone (onsen + Fuji views) or Nikko (shrines + nature).',
            ].join(' '),
        },
        {
            source: 'Curated: NYC transit + neighborhoods',
            tags: { destination: 'New York', topic: 'transport' },
            text: [
                'NYC: stay near a major subway line; avoid long cross-borough commutes.',
                'Top areas for first-timers: Midtown (central), Lower Manhattan (walkable), Williamsburg (Brooklyn vibe).',
                'Use OMNY for subway payments; plan museum days mid-week to avoid crowds.',
            ].join(' '),
        },
        {
            source: 'Curated: budget heuristics',
            tags: { topic: 'budget' },
            text: [
                'Budget heuristic: flights are the biggest swing factor; lock dates first, then flights, then hotels.',
                'For a 1–2 week trip, budget daily spend (food + activities) separately from fixed costs.',
            ].join(' '),
        },
    ];

    const created = [];
    for (const chunk of samples) {
        const embedding = await embedText(chunk.text);
        created.push(
            await KnowledgeChunk.create({
                text: chunk.text,
                source: chunk.source,
                tags: chunk.tags,
                embedding,
            })
        );
    }

    return created.length;
}

export async function searchKnowledgeVector(params: {
    query: string;
    destination?: string;
    limit?: number;
}) {
    const { query, destination, limit = 6 } = params;
    const embedding = await embedText(query);

    // Atlas Vector Search stage is only available on Atlas clusters with a configured vector index.
    // If it fails (local MongoDB or missing index), fall back to a lightweight text match.
    const db = mongoose.connection.db;
    if (!db) throw new Error('MongoDB is not connected');
    const collection = db.collection('knowledge_chunks');

    try {
        const pipeline: any[] = [
            {
                $vectorSearch: {
                    index: process.env.ATLAS_VECTOR_INDEX || 'knowledge_embedding',
                    path: 'embedding',
                    queryVector: embedding,
                    numCandidates: Math.max(50, limit * 10),
                    limit,
                    ...(destination
                        ? {
                            filter: { 'tags.destination': destination },
                        }
                        : {}),
                },
            },
            {
                $project: {
                    _id: 0,
                    text: 1,
                    source: 1,
                    tags: 1,
                    score: { $meta: 'vectorSearchScore' },
                },
            },
        ];

        const docs = (await collection.aggregate(pipeline).toArray()) as unknown as KnowledgeResult[];
        return docs;
    } catch {
        const regex = new RegExp(query.split(/\s+/).slice(0, 6).join('|'), 'i');
        const docs = await collection
            .find(
                destination ? { 'tags.destination': destination, text: regex } : { text: regex },
                { projection: { _id: 0, text: 1, source: 1, tags: 1 } }
            )
            .limit(limit)
            .toArray();
        return docs as unknown as KnowledgeResult[];
    }
}
