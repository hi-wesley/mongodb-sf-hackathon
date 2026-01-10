import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { EventHorizon } from './core/engine';
import { Workflow, Step, StepStatus } from './db/schema';
import { OpenAI } from 'openai';

dotenv.config();

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

// POST /api/workflows - Create a new dynamic workflow
app.post('/api/workflows', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    console.log(`🧠 API Request: Plan workflow for "${prompt}"`);

    try {
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
                    4. Include WAIT steps if needed (agent="System").
                    5. Last step: "Send Final Itinerary" (agent="Planner").
                    
                    Example:
                    [
                        { "name": "Find Flights", "agent": "LogisticsAgent" },
                        { "name": "WAIT: 5000", "agent": "System" },
                        { "name": "Book Hotel", "agent": "FinancialAgent" }
                    ]`
                },
                { role: "user", content: prompt }
            ],
            temperature: 0.7,
        });

        const rawContent = completion.choices[0].message.content;
        const cleanContent = rawContent?.replace(/```json/g, '').replace(/```/g, '').trim() || "[]";
        const stepsData = JSON.parse(cleanContent);

        // Create Workflow
        const wf = await engine.createWorkflow(prompt, []); // engine.createWorkflow expects just strings? We need to update it or manually insert.
        // Let's manually insert to support attributes like 'assignedAgent' which we will add to schema.

        // Wait, schema update is next task. For now, we will store agent name in local variable 
        // OR we update schema NOW to avoid breaking changes.
        // Let's update schema in the next step, but here we prepare the data.
        // For now, mapping back to simple strings for compatibility, will update shortly.

        // Temporarily just use names until schema is updated
        const stepDocs = stepsData.map((s: any, index: number) => ({
            workflowId: wf._id,
            name: s.name,
            assignedAgent: s.agent || 'System',
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

// Start Server
app.listen(port, () => {
    console.log(`🚀 API Server running on port ${port}`);
    // Start Engine Loop non-blocking
    startEngine();
});
