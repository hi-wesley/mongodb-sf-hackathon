import mongoose from 'mongoose';
import { OpenAI } from 'openai';
import { EventHorizon } from './core/engine';
import { Workflow, Step, StepStatus } from './db/schema';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function createDynamicWorkflow() {
    // 1. Get User Input
    const userPrompt = process.argv.slice(2).join(' ') || "Plan a 2 week trip to Japan in July";
    console.log(`🧠 AI Planner received request: "${userPrompt}"`);

    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing');
    await mongoose.connect(process.env.MONGODB_URI);

    // Clear old data
    await Workflow.deleteMany({});
    await Step.deleteMany({});

    // 2. Call OpenAI to plan the steps
    console.log('🤔 Thinking...');
    const completion = await openai.chat.completions.create({
        model: "gpt-5-nano",
        messages: [
            {
                role: "system",
                content: `You are an expert agentic planner. 
                Your goal is to break down a user request into a linear list of executable steps.
                
                Rules:
                1. Output ONLY a raw JSON array of strings. No markdown, no explanations.
                2. If the user mentions waiting or time, include steps like "WAIT: 5000" (for 5 seconds) or "WAIT: 1000" (for 1 second).
                3. The last step should always be "Send Final Itinerary".
                4. Keep steps concise, e.g., "Find Flights", "Book Hotel".
                
                Example Output:
                ["Find Flights", "WAIT: 2000", "Book Hotel", "Send Final Itinerary"]`
            },
            {
                role: "user",
                content: userPrompt
            }
        ],
        temperature: 0.7,
    });

    const rawContent = completion.choices[0].message.content;
    console.log(`💡 OpenAI Plan: ${rawContent}`);

    let steps: string[] = [];
    try {
        // Handle potential markdown code blocks if the model ignores the "no markdown" rule
        const cleanContent = rawContent?.replace(/```json/g, '').replace(/```/g, '').trim() || "[]";
        steps = JSON.parse(cleanContent);
    } catch (e) {
        console.error("Failed to parse OpenAI response:", e);
        process.exit(1);
    }

    if (!Array.isArray(steps) || steps.length === 0) {
        console.error("OpenAI returned invalid steps.");
        process.exit(1);
    }

    // 3. Seed Database
    const engine = new EventHorizon();
    const wf = await engine.createWorkflow(userPrompt, []);

    const stepDocs = steps.map((name, index) => ({
        workflowId: wf._id,
        name,
        status: index === 0 ? StepStatus.PENDING : StepStatus.BLOCKED
    }));
    await Step.insertMany(stepDocs);

    console.log(`✨ Created valid workflow with ${steps.length} steps.`);
    console.log('Run "npm start" to execute the plan!');

    await mongoose.disconnect();
}

createDynamicWorkflow().catch(console.error);
