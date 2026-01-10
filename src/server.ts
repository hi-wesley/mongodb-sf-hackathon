import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { EventHorizon } from './core/engine';
import { Workflow, Step, StepStatus } from './db/schema';
import { OpenAI } from 'openai';
import { searchKnowledgeVector, seedKnowledgeChunks } from './db/knowledge';

dotenv.config();

function normalizeAgentName(raw: unknown): string {
    const value = String(raw ?? '').trim();
    const key = value.toLowerCase().replace(/[^a-z]/g, '');
    if (!key) return 'System';
    if (key.includes('planner')) return 'Planner';
    if (key.includes('research')) return 'ResearchAgent';
    if (key.includes('logistics')) return 'LogisticsAgent';
    if (key.includes('visa')) return 'VisaAgent';
    if (key.includes('financial') || key.includes('finance')) return 'FinancialAgent';
    if (key.includes('system')) return 'System';
    return value;
}

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;
const engine = new EventHorizon();

// Start the engine in the background
// We wait for DB connection first inside engine.start() usually, 
// allows engine to handle its own connection or share one.
// The engine.start() is blocking loop, so we shouldn't await it strictly if it loops forever.
// Actually engine.start() loops. We need to run it asynchronously.
const startEngine = async () => {
    try {
        await engine.start();
    } catch (err) {
        console.error("Engine failed:", err);
    }
};

// API Routes

// GET /api/status - Check if system is running
app.get('/api/status', (req, res) => {
    res.json({ status: 'online', uptime: process.uptime() });
});

// GET /api/workflows - Get recent workflows
app.get('/api/workflows', async (req, res) => {
    try {
        const workflows = await Workflow.find().sort({ createdAt: -1 }).limit(10);
        res.json(workflows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch workflows' });
    }
});

// GET /api/workflows/:id - Get full details including steps
app.get('/api/workflows/:id', async (req, res) => {
    try {
        const workflow = await Workflow.findById(req.params.id);
        if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

        const steps = await Step.find({ workflowId: workflow._id }).sort({ scheduledFor: 1, _id: 1 });
        res.json({ ...workflow.toJSON(), steps });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch workflow details' });
    }
});

// DELETE /api/workflows - Clear recent missions (workflows + steps)
app.delete('/api/workflows', async (_req, res) => {
    try {
        const [stepsResult, workflowsResult] = await Promise.all([
            Step.deleteMany({}),
            Workflow.deleteMany({}),
        ]);
        res.json({
            success: true,
            deletedSteps: stepsResult.deletedCount ?? 0,
            deletedWorkflows: workflowsResult.deletedCount ?? 0,
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/knowledge/seed - Seed a small curated knowledge base (requires OPENAI_API_KEY for embeddings)
app.post('/api/knowledge/seed', async (_req, res) => {
    try {
        const count = await seedKnowledgeChunks();
        res.json({ success: true, inserted: count });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/knowledge/search?q=...&destination=...
app.get('/api/knowledge/search', async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        if (!q) return res.status(400).json({ error: 'q is required' });
        const destination = req.query.destination ? String(req.query.destination) : undefined;
        const results = await searchKnowledgeVector({ query: q, destination, limit: 6 });
        res.json({ results });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/prices/trend?destination=... (requires existing samples; engine will auto-seed synthetic samples when generating dates)
app.get('/api/prices/trend', async (req, res) => {
    try {
        const destination = String(req.query.destination || '').trim();
        if (!destination) return res.status(400).json({ error: 'destination is required' });
        const db = mongoose.connection.db;
        if (!db) return res.status(500).json({ error: 'MongoDB is not connected' });

        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setMonth(end.getMonth() + 3);

        const trend = await db
            .collection('price_samples')
            .aggregate([
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
                    },
                },
                { $sort: { _id: 1 } },
                {
                    $project: {
                        _id: 0,
                        weekStart: '$_id',
                        avgPrice: { $round: ['$avgPrice', 0] },
                    },
                },
            ])
            .toArray();

        res.json({ destination, trend });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/workflows - Create a new dynamic workflow
app.post('/api/workflows', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    console.log(`🧠 API Request: Plan workflow for "${prompt}"`);

    try {
        const destinationGuess = prompt.match(/\bto\s+([^,.]+?)(?:\s+for\b|\s+in\b|\s*$)/i)?.[1]?.trim();
        const knowledge = await searchKnowledgeVector({
            query: prompt,
            destination: destinationGuess,
            limit: 6,
        }).catch(() => []);

        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const completion = await openai.chat.completions.create({
            model: "gpt-5-nano",
            messages: [
                {
                    role: "system",
                    content: `You are an expert agentic planner. 
                    Break down the user request into linear steps.
                    
                     Rules:
                    1. Output ONLY a raw JSON array of objects.
                    2. Schema: { "name": "Step Name", "agent": "AgentName" }
                    3. Agents: "Planner", "ResearchAgent", "LogisticsAgent", "VisaAgent", "FinancialAgent".
                    4. Do NOT include WAIT steps. The system handles timing automatically.
                    5. The ONLY itinerary-writing step is the last step: "Send Final Itinerary" (agent="Planner"). Do NOT include draft/day-by-day itinerary steps.
                    6. Use these step names/keywords so the UI can render results: Dates, Flights, Accommodation/Hotels, Local Transport, Must-See/Activities, Budget, Visa.
                    7. Use the provided travel notes when helpful.

                    Travel notes (grounding):
                    ${knowledge.map(k => `- (${k.source}) ${k.text}`).join('\n')}

                    Example:
                    [
                        { "name": "Select Dates", "agent": "Planner" },
                        { "name": "Find Flights", "agent": "LogisticsAgent" },
                        { "name": "Suggest Accommodation Options", "agent": "LogisticsAgent" },
                        { "name": "Plan Local Transportation", "agent": "LogisticsAgent" },
                        { "name": "Must-See Places & Activities", "agent": "ResearchAgent" },
                        { "name": "Estimate Budget", "agent": "FinancialAgent" },
                        { "name": "Check Visa Requirements", "agent": "VisaAgent" },
                        { "name": "Send Final Itinerary", "agent": "Planner" }
                    ]`
                },
                { role: "user", content: prompt }
            ],
        });

        const rawContent = completion.choices[0].message.content;
        const cleanContent = rawContent?.replace(/```json/g, '').replace(/```/g, '').trim() || "[]";
        const parsed = JSON.parse(cleanContent);
        const stepsData: Array<{ name: string; agent: string }> = (Array.isArray(parsed) ? parsed : [])
            .map((s: any) => ({
                name: String(s?.name ?? '').replace(/\s+/g, ' ').trim(),
                agent: normalizeAgentName(s?.agent),
            }))
            .filter(s => s.name.length > 0);

        const isFinalItineraryStep = (name: string) => {
            const lower = name.trim().toLowerCase();
            return lower === 'send final itinerary' || lower.includes('final itinerary');
        };
        const isWaitStep = (name: string) => /^wait\b/i.test(name.trim());
        const isDraftItineraryStep = (step: { name: string; agent: string }) => {
            if (step.agent !== 'Planner') return false;
            if (isFinalItineraryStep(step.name)) return false;
            return /\b(draft|day[- ]by[- ]day|itinerary|schedule)\b/i.test(step.name);
        };

        const filteredSteps = stepsData.filter(s => !isWaitStep(s.name) && !isDraftItineraryStep(s));

        const finalIndex = filteredSteps.findIndex(s => isFinalItineraryStep(s.name));
        const finalStep = finalIndex >= 0 ? filteredSteps.splice(finalIndex, 1)[0] : { name: 'Send Final Itinerary', agent: 'Planner' };
        filteredSteps.push({ name: 'Send Final Itinerary', agent: 'Planner' });
        // If the model already included a final step, keep it (and its agent) but ensure it's last.
        filteredSteps[filteredSteps.length - 1] = finalStep;

        // Create Workflow
        const wf = await engine.createWorkflow(prompt, [], {
            destination: destinationGuess,
            knowledge: knowledge.map(k => ({ source: k.source, text: k.text, score: k.score })),
        });
        // Let's manually insert to support attributes like 'assignedAgent' which we will add to schema.

        // Wait, schema update is next task. For now, we will store agent name in local variable 
        // OR we update schema NOW to avoid breaking changes.
        // Let's update schema in the next step, but here we prepare the data.
        // For now, mapping back to simple strings for compatibility, will update shortly.

        // Temporarily just use names until schema is updated
        const stepDocs = filteredSteps.map((s: any, index: number) => ({
            workflowId: wf._id,
            name: s.name,
            assignedAgent: normalizeAgentName(s.agent),
            status: index === 0 ? StepStatus.PENDING : StepStatus.BLOCKED,
            scheduledFor: new Date()
        }));

        // We delete the dummy steps created by createWorkflow if any, 
        // but createWorkflow(prompt, []) creates none.
        await Step.insertMany(stepDocs);

        res.json({ success: true, workflowId: wf._id, message: 'Workflow created' });

    } catch (err: any) {
        console.error("Planning failed:", err);
        res.status(500).json({ error: err.message });
    }
});

async function main() {
    if (!process.env.MONGODB_URI) {
        console.warn('MONGODB_URI is missing; API will fail until it is set.');
    } else if (mongoose.connection.readyState !== 1) {
        await mongoose.connect(process.env.MONGODB_URI);
    }

    app.listen(port, () => {
        console.log(`🚀 API Server running on port ${port}`);
        // Start Engine Loop non-blocking
        startEngine();
    });
}

main().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
