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
                const content = `# 🇯🇵 Trip Itinerary: Japan 2026

**Status:** Confirmed ✅

## ✈️ Flights
- **Outbound:** JL005 (SFO -> HND) - March 15th
- **Return:** JL006 (HND -> SFO) - March 29th

## 🏨 Accommodation
- **Tokyo:** Shinjuku Prince Hotel (5 Nights)
- **Kyoto:** Ryokan Yamazaki (4 Nights)
- **Osaka:** Swissotel Nankai (5 Nights)

## 🌸 Key Activities
- Cherry Blossom Viewing at Ueno Park
- Fushimi Inari Shrine Hike
- Dotonbori Food Tour

*Generated by Event Horizon Agent at ${new Date().toLocaleString()}*
`;
                fs.writeFileSync('final_itinerary.md', content);
                console.log('📄 Generated final_itinerary.md file in project root.');
                step.logs.push('Generated final_itinerary.md');

                console.log('🏁 Workflow Complete. Shutting down.');
                process.exit(0);
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
