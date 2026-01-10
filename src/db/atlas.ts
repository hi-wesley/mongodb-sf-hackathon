import mongoose from 'mongoose';

export type PriceSampleMeta = {
    kind: 'flight' | 'hotel';
    destination: string;
    route?: string;
    provider?: string;
};

export type PriceSample = {
    ts: Date;
    meta: PriceSampleMeta;
    price: number;
    currency: string;
};

export async function ensurePriceSamplesTimeSeriesCollection() {
    const db = mongoose.connection.db;
    if (!db) throw new Error('MongoDB is not connected');

    const existing = await db.listCollections({ name: 'price_samples' }).toArray();
    if (existing.length > 0) return;

    try {
        await db.createCollection('price_samples', {
            timeseries: {
                timeField: 'ts',
                metaField: 'meta',
                granularity: 'hours',
            },
        });
    } catch (err) {
        // If the user lacks createCollection privileges (or the server doesn't support time-series),
        // we can still operate with a regular collection.
        console.warn('⚠️ Failed to create time-series collection price_samples; falling back to regular collection.', err);
    }
}

export function priceSamplesCollection() {
    const db = mongoose.connection.db;
    if (!db) throw new Error('MongoDB is not connected');
    return db.collection<PriceSample>('price_samples');
}

export async function ensureSyntheticPriceSamples(params: {
    destination: string;
    kind: 'flight' | 'hotel';
    start: Date;
    days: number;
}) {
    const { destination, kind, start, days } = params;
    const collection = priceSamplesCollection();

    const existingCount = await collection.countDocuments({
        'meta.destination': destination,
        'meta.kind': kind,
    });
    if (existingCount > 0) return;

    const docs: PriceSample[] = [];
    const base = kind === 'flight' ? 920 : 180;
    for (let i = 0; i < days; i += 1) {
        const ts = new Date(start);
        ts.setDate(ts.getDate() + i);
        ts.setHours(12, 0, 0, 0);

        const weekly = Math.sin((i / 7) * Math.PI * 2) * (kind === 'flight' ? 60 : 18);
        const noise = (Math.random() - 0.5) * (kind === 'flight' ? 90 : 35);
        const price = Math.max(40, Math.round(base + weekly + noise));

        docs.push({
            ts,
            meta: { kind, destination, provider: 'synthetic' },
            price,
            currency: 'USD',
        });
    }

    await collection.insertMany(docs);
}

export async function flightPriceTrendByWeek(params: { destination: string; start: Date; end: Date }) {
    const { destination, start, end } = params;
    const collection = priceSamplesCollection();

    const results = await collection
        .aggregate<{
            weekStart: Date;
            avgPrice: number;
            minPrice: number;
            maxPrice: number;
        }>([
            {
                $match: {
                    ts: { $gte: start, $lt: end },
                    'meta.kind': 'flight',
                    'meta.destination': destination,
                },
            },
            {
                $group: {
                    _id: { $dateTrunc: { date: '$ts', unit: 'week' } },
                    avgPrice: { $avg: '$price' },
                    minPrice: { $min: '$price' },
                    maxPrice: { $max: '$price' },
                },
            },
            { $sort: { avgPrice: 1 } },
            {
                $project: {
                    _id: 0,
                    weekStart: '$_id',
                    avgPrice: { $round: ['$avgPrice', 0] },
                    minPrice: 1,
                    maxPrice: 1,
                },
            },
        ])
        .toArray();

    return results;
}
