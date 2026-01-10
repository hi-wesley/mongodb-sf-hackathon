import Link from 'mongoose';
import mongoose from 'mongoose';
import { EventHorizon } from './core/engine';
import dotenv from 'dotenv';
import { Workflow, Step } from './db/schema';

dotenv.config();

async function seed() {
    console.log('🌱 Seeding database...');
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing');
    await mongoose.connect(process.env.MONGODB_URI);

    // Clear old data
    await Workflow.deleteMany({});
    await Step.deleteMany({});

    const engine = new EventHorizon();
    // We don't start the engine, just use the helper to create data
    const wf = await engine.createWorkflow('Demonstrate Resilience', [
        'Initialize System',
        'Load Context',
        'CRASH_ME_NOW', // This step will cause a process exit
        'Recovered Step',
        'Finalize Report'
    ]);

    console.log(`Created Workflow: ${wf.id}`);
    console.log('Steps created. Run "npm start" to see the agent crash and resume.');

    await mongoose.disconnect();
}

seed().catch(console.error);
