import mongoose from 'mongoose';
import { EventHorizon } from './core/engine';
import dotenv from 'dotenv';
import { Workflow, Step } from './db/schema';

dotenv.config();

async function seed() {
    console.log('✈️  Seeding Travel Assistant data...');
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing');
    await mongoose.connect(process.env.MONGODB_URI);

    // Clear old data
    await Workflow.deleteMany({});
    await Step.deleteMany({});

    const engine = new EventHorizon();

    // Create a trip workflow
    const steps = [
        'Find Flights',
        'WAIT: 10000',     // Simulates "Wait 3 months until visa window opens"
        'Apply for Visa',
        'WAIT: 5000',      // Simulates "Wait 2 weeks for approval"
        'Book Hotels',
        'Send Final Itinerary'
    ];

    const wf = await engine.createWorkflow('Trip to Japan 2026', []);

    // Custom manual insert to control status
    const stepDocs = steps.map((name, index) => ({
        workflowId: wf._id,
        name,
        status: index === 0 ? 'PENDING' : 'BLOCKED' // Only first step is PENDING
    }));
    await Step.insertMany(stepDocs);

    console.log(`Created Trip Workflow: ${wf.id}`);
    console.log('Steps created. Run "npm start" to watch the agent work, sleep, and wake up.');

    await mongoose.disconnect();
}

seed().catch(console.error);
