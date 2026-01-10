import mongoose from 'mongoose';
import { Workflow, Step, WorkflowStatus, StepStatus } from '../db/schema';
import { v4 as uuidv4 } from 'uuid';

export class EventHorizon {
    private isRunning: boolean = false;
    private pollInterval: number = 2000; // 2 seconds

    async start() {
        this.isRunning = true;
        console.log('🌌 Event Horizon Engine Starting...');

        // Connect to DB
        if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB.');

        // RECOVERY: Check for any "RUNNING" workflows that were interrupted
        await this.recoverState();

        this.loop();
    }

    async stop() {
        this.isRunning = false;
        await mongoose.disconnect();
        console.log('Engine stopped.');
    }

    private async recoverState() {
        console.log('Checking for interrupted workflows...');
        // Find steps that are marked RUNNING. This means we crashed mid-step.
        // In a real system, we might re-queue them or fail them. 
        // For this demo, we'll mark them as PENDING so they get picked up again instantly.
        const stuckSteps = await Step.find({ status: StepStatus.RUNNING });
        for (const step of stuckSteps) {
            console.log(`⚠️ Recovering stuck step: ${step.name} (ID: ${step._id})`);
            step.status = StepStatus.PENDING;
            await step.save();
        }
    }

    private async loop() {
        while (this.isRunning) {
            try {
                const step = await this.acquireNextStep();
                if (step) {
                    await this.executeStep(step);
                } else {
                    // No work found, sleep briefly
                    await new Promise(r => setTimeout(r, this.pollInterval));
                }
            } catch (error) {
                console.error('Error in engine loop:', error);
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }

    private async acquireNextStep() {
        // Find the oldest PENDING step that is ready (scheduledFor <= now)
        const now = new Date();
        const step = await Step.findOneAndUpdate(
            {
                status: StepStatus.PENDING,
                scheduledFor: { $lte: now }
            },
            { status: StepStatus.RUNNING },
            { sort: { scheduledFor: 1, _id: 1 }, new: true }
        );
        return step;
    }

    private async executeStep(step: any) {
        console.log(`🚀 Executing Step: ${step.name}`);

        try {
            // SIMULATE WORK
            // In a real agent, this would call an LLM or a tool.
            // We will define specific "Step Handlers" or just generic logic here.

            // Update logs in real-time
            step.logs.push(`Started execution at ${new Date().toISOString()}`);
            await step.save();

            // Simulate processing time
            await new Promise(r => setTimeout(r, 1000));

            // Check for WAIT instruction (e.g. "WAIT: 5000" means wait 5 seconds)
            if (step.name.startsWith('WAIT:')) {
                const ms = parseInt(step.name.split(':')[1].trim());
                console.log(`🕒 Encountered WAIT instruction. Sleeping for ${ms}ms...`);

                // In a real system, we would create a NEW step scheduled for later.
                // For this demo, we will just reschedule THIS step to "restart" later.
                // Or better: Current step is DONE, next step is scheduled.
                // Let's assume the user put a specific "Wait" step in the workflow to delay the NEXT step.
                // Actually, simplest is: This step is "Wait", it just marks itself done, 
                // AND it finds the NEXT step in the workflow and updates its 'scheduledFor'.

                // For simplicity in this demo: We essentially "blocking wait" here? NO.
                // We want to demonstrate the engine sleeping.
                // so we need the Next step to be scheduled in the future.
                // Let's implement dynamic scheduling:
                // If this step is "Wait 3 days", we find the next step and set its scheduledFor = now + 3 days.
                const nextStep = await Step.findOne({
                    workflowId: step.workflowId,
                    status: 'BLOCKED', // It should be blocked
                    _id: { $ne: step._id }
                }).sort({ _id: 1 });

                if (nextStep) {
                    nextStep.scheduledFor = new Date(Date.now() + ms);
                    await nextStep.save();
                    step.logs.push(`Scheduled next step '${nextStep.name}' for ${nextStep.scheduledFor.toISOString()}`);
                }
            }

            // SIMULATE ADAPTIVE RETRIEVAL / MULTI-AGENT THOUGHTS
            if (step.assignedAgent === 'ResearchAgent' || step.name.includes('Research')) {
                const thoughts = [
                    'Analyzing user intent...',
                    'Querying internal vector database...',
                    'Found 12 relevant documents.',
                    'Refining search: adding spatial constraints...',
                    'Cross-referencing with live web data...',
                    'Synthesizing answer from multiple sources.'
                ];
                for (const t of thoughts) {
                    step.logs.push(t);
                    await step.save();
                    await new Promise(r => setTimeout(r, 800)); // Delay to show animation in UI
                }
            } else if (step.assignedAgent === 'VisaAgent') {
                step.logs.push('Checking embassy appointment availability...');
                await step.save();
                await new Promise(r => setTimeout(r, 1000));
                step.logs.push('Found slot: March 14th.');
            }

            // GENERATE RICH OUTPUT DATA (Mocking Real APIs)
            if (step.name.toLowerCase().includes('weather')) {
                step.output = {
                    type: 'weather',
                    location: 'New York',
                    forecast: [
                        { date: '2026-05-12', temp: 72, condition: 'Sunny' },
                        { date: '2026-05-13', temp: 68, condition: 'Partly Cloudy' },
                        { date: '2026-05-14', temp: 65, condition: 'Rain' }
                    ]
                };
            } else if (step.name.toLowerCase().includes('flight')) {
                step.output = {
                    type: 'flights',
                    options: [
                        { airline: 'SpaceX', flight: 'SX-882', time: '10:00 AM', price: '$450', duration: '4h 30m' },
                        { airline: 'Delta', flight: 'DL-249', time: '02:00 PM', price: '$380', duration: '5h 10m' },
                    ]
                };
            } else if (step.name.toLowerCase().includes('event') || step.name.toLowerCase().includes('visit')) {
                step.output = {
                    type: 'events',
                    items: [
                        { name: 'Met Gala Exhibition', date: 'May 2026', type: 'Art' },
                        { name: 'Central Park Jazz Fest', date: 'May 15th', type: 'Music' },
                        { name: 'Empire State Building Tour', date: 'Daily', type: 'Sightseeing' }
                    ]
                };
            } else if (step.name.toLowerCase().includes('date')) {
                step.output = {
                    type: 'dates',
                    recommendation: 'May 12 - May 26, 2026',
                    reason: 'Optimal weather and scheduled cultural events.'
                };
            }

            await step.save();

            // Check for a specific "poison pill" to simulate a crash
            if (step.name.includes('CRASH_ME')) {
                console.log('💥 PRETENDING TO CRASH NOW!');
                process.exit(1); // Hard crash
            }

            step.output = { result: `Success for ${step.name}`, timestamp: Date.now() };
            step.status = StepStatus.COMPLETED;
            step.logs.push(`Completed successfully.`);
            await step.save();

            console.log(`✅ Step ${step.name} completed.`);

            // SPECIAL HANDLER: Real output for demo
            if (step.name === 'Send Final Itinerary') {
                const fs = await import('node:fs');

                // Fetch the original goal to make the output relevant
                const wf = await Workflow.findById(step.workflowId);
                const userGoal = wf?.goal || "A Trip";

                console.log(`✍️  Generating specific itinerary for "${userGoal}" using OpenAI...`);

                try {
                    const openai = new (await import('openai')).OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                    const completion = await openai.chat.completions.create({
                        model: "gpt-5-nano",
                        messages: [
                            {
                                role: "system",
                                content: `You are a travel agent. Generate a beautiful markdown itinerary file content.
                                Use emojis. structure it with "Flights", "Accommodation", and "Activities".
                                Keep it brief but realistic.`
                            },
                            { role: "user", content: `Create a final itinerary for: ${userGoal}` }
                        ]
                    });

                    const content = completion.choices[0].message.content || "# Itinerary\nFailed to generate.";

                    fs.writeFileSync('final_itinerary.md', content);
                    console.log('📄 Generated custom final_itinerary.md file in project root.');
                    step.logs.push('Generated final_itinerary.md');

                    console.log('✅ Workflow complete. Ready for next mission.');
                    // process.exit(0); // Removed to allow continuous operation

                } catch (err) {
                    console.error("Failed to generate itinerary:", err);
                }
            }

            // TRIGGER NEXT STEP
            // Use _id for reliable sorting since createdAt might be identical in batch inserts
            const nextStep = await Step.findOne({
                workflowId: step.workflowId,
                status: 'BLOCKED',
                _id: { $ne: step._id }
            }).sort({ _id: 1 });

            if (nextStep) {
                // If scheduledFor was set by the WAIT logic, respect it.
                // Otherwise set it to now.
                if (nextStep.scheduledFor <= new Date()) {
                    nextStep.scheduledFor = new Date();
                }
                nextStep.status = StepStatus.PENDING;
                await nextStep.save();
                console.log(`🔓 Unblocked next step: ${nextStep.name}`);
            }


        } catch (err: any) {
            console.error(`❌ Step failed: ${err.message}`);
            step.status = StepStatus.FAILED;
            step.logs.push(`Error: ${err.message}`);
            await step.save();
        }
    }

    // Helper to submit a new workflow
    async createWorkflow(goal: string, steps: string[]) {
        const wf = await Workflow.create({ goal, key: uuidv4() });
        const stepDocs = steps.map(s => ({
            workflowId: wf._id,
            name: s,
            status: StepStatus.PENDING
        }));
        await Step.insertMany(stepDocs);
        return wf;
    }
}
