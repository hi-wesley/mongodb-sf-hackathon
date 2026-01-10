import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { seedKnowledgeChunks } from './db/knowledge';

dotenv.config();

async function main() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing');
    await mongoose.connect(process.env.MONGODB_URI);
    const inserted = await seedKnowledgeChunks();
    console.log(`✅ Seeded knowledge chunks: ${inserted}`);
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

