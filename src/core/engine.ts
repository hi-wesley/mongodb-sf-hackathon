import mongoose from 'mongoose';
import { Workflow, Step, WorkflowStatus, StepStatus } from '../db/schema';
import { v4 as uuidv4 } from 'uuid';
import { ensurePriceSamplesTimeSeriesCollection, ensureSyntheticPriceSamples, flightPriceTrendByWeek } from '../db/atlas';
import { searchKnowledgeVector } from '../db/knowledge';

export class EventHorizon {
    private isRunning: boolean = false;
    private pollInterval: number = 2000; // 2 seconds

    async start() {
        this.isRunning = true;
        console.log('🌌 Event Horizon Engine Starting...');

        // Connect to DB
        if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing');
        if (mongoose.connection.readyState !== 1) {
            await mongoose.connect(process.env.MONGODB_URI);
        }
        console.log('Connected to MongoDB.');
        try {
            await ensurePriceSamplesTimeSeriesCollection();
        } catch (err) {
            console.warn('⚠️ price_samples setup failed; continuing without time-series optimizations.', err);
        }

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
            if (!Array.isArray(step.logs)) step.logs = [];
            step.logs.push(`Started execution at ${new Date().toISOString()}`);
            await step.save();

            // Stream some "agent thoughts" so the UI reliably shows RUNNING state
            const isWaitStep = step.name.startsWith('WAIT:');
            if (!isWaitStep) {
                const genericThoughts = [
                    `[${step.assignedAgent}] Assessing requirements...`,
                    `[${step.assignedAgent}] Querying providers...`,
                    `[${step.assignedAgent}] Processing results...`,
                    `[${step.assignedAgent}] Verifying constraints...`,
                ];
                for (const t of genericThoughts) {
                    step.logs.push(t);
                    await step.save();
                    await new Promise(r => setTimeout(r, 450));
                }
            }

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
                    status: StepStatus.BLOCKED, // It should be blocked
                    _id: { $ne: step._id }
                }).sort({ _id: 1 });

                if (nextStep) {
                    nextStep.scheduledFor = new Date(Date.now() + ms);
                    await nextStep.save();
                    step.logs.push(`Scheduled next step '${nextStep.name}' for ${nextStep.scheduledFor.toISOString()}`);
                }
            }

            // Specific logs override or append
            // The specific ResearchAgent and VisaAgent blocks are removed as the generic one covers it for now.

            // GENERATE USER-FACING TRAVEL OUTPUT (Mocking Real APIs)
            const workflow = await Workflow.findById(step.workflowId);
            const goal = workflow?.goal ?? '';
            const destination = this.inferDestination(goal);
            const durationDays = this.inferDurationDays(goal);

            const knowledge = await this.retrieveStepKnowledge({
                goal,
                destination,
                stepName: step.name,
            });
            if (knowledge.length > 0) {
                step.retrievalContext = {
                    sources: knowledge,
                };
            }

            const { output, contextPatch } = await this.buildUserFacingOutput({
                stepName: step.name,
                assignedAgent: step.assignedAgent,
                goal,
                destination,
                durationDays,
                context: workflow?.context ?? {},
                scheduledFor: step.scheduledFor,
                knowledge,
            });

            if (output !== undefined) {
                step.output = output;
            }

            await step.save();

            if (workflow && contextPatch && Object.keys(contextPatch).length > 0) {
                workflow.context = { ...(workflow.context ?? {}), ...contextPatch };
                workflow.markModified('context');
                await workflow.save();
            }

            // Check for a specific "poison pill" to simulate a crash
            if (step.name.includes('CRASH_ME')) {
                console.log('💥 PRETENDING TO CRASH NOW!');
                process.exit(1); // Hard crash
            }

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
                    const existingOutput =
                        step.output && typeof step.output === 'object' && !Array.isArray(step.output)
                            ? step.output
                            : undefined;
                    step.output = {
                        ...(existingOutput ?? {}),
                        type: 'markdown',
                        itineraryMarkdown: content,
                        file: 'final_itinerary.md'
                    };
                    await step.save();
                    if (wf) {
                        wf.context = { ...(wf.context ?? {}), itineraryMarkdown: content };
                        wf.markModified('context');
                        await wf.save();
                    }

                    console.log('✅ Workflow complete. Ready for next mission.');
                    // process.exit(0); // Removed to allow continuous operation

                } catch (err) {
                    console.error("Failed to generate itinerary:", err);
                    step.logs.push('Failed to generate itinerary via OpenAI; showing the template itinerary instead.');
                    await step.save();
                }
            }

            // TRIGGER NEXT STEP
            // Use _id for reliable sorting since createdAt might be identical in batch inserts
            const nextStep = await Step.findOne({
                workflowId: step.workflowId,
                status: StepStatus.BLOCKED,
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

    private normalizeAgentName(raw: unknown): string {
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

    private inferDurationDays(goal: string): number {
        const numeric = goal.match(/\b(\d+)\s*(day|week|month)s?\b/i);
        if (numeric) {
            const value = Number(numeric[1]);
            const unit = numeric[2].toLowerCase();
            if (!Number.isFinite(value) || value <= 0) return 14;
            if (unit.startsWith('day')) return value;
            if (unit.startsWith('week')) return value * 7;
            if (unit.startsWith('month')) return value * 30;
        }

        const wordToNumber: Record<string, number> = {
            one: 1,
            two: 2,
            three: 3,
            four: 4,
            five: 5,
            six: 6,
            seven: 7,
            eight: 8,
            nine: 9,
            ten: 10,
        };
        const word = goal.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*(day|week|month)s?\b/i);
        if (word) {
            const value = wordToNumber[word[1].toLowerCase()] ?? 14;
            const unit = word[2].toLowerCase();
            if (unit.startsWith('day')) return value;
            if (unit.startsWith('week')) return value * 7;
            if (unit.startsWith('month')) return value * 30;
        }

        return 14;
    }

    private inferDestination(goal: string): string {
        const normalized = goal.replace(/\s+/g, ' ').trim();
        const toMatch = normalized.match(/\bto\s+([^,.]+?)(?:\s+for\b|\s+in\b|\s+with\b|\s+on\b|\s*$)/i);
        if (toMatch?.[1]) return this.canonicalizeDestination(toMatch[1].trim());

        const inMatch = normalized.match(/\bin\s+([^,.]+?)(?:\s+for\b|\s*$)/i);
        if (inMatch?.[1]) return this.canonicalizeDestination(inMatch[1].trim());

        return 'your destination';
    }

    private canonicalizeDestination(destination: string): string {
        const lower = destination.toLowerCase().trim();
        const hasWord = (word: string) => new RegExp(`\\b${word}\\b`, 'i').test(lower);

        if (
            lower.includes('san francisco') ||
            lower.includes('san fran') ||
            lower.includes('san fransisco') ||
            hasWord('sf') ||
            hasWord('sfo') ||
            lower.includes('bay area')
        ) {
            return 'San Francisco';
        }
        if (lower.includes('singapore') || hasWord('sg')) return 'Singapore';
        if (lower.includes('new york') || hasWord('nyc') || hasWord('ny')) return 'New York';
        if (lower.includes('tokyo')) return 'Tokyo';
        if (lower.includes('japan')) return 'Japan';
        if (lower.includes("xi'an") || lower.includes('xian')) return "Xi'an";
        if (lower.includes('beijing')) return 'Beijing';
        if (lower.includes('shanghai')) return 'Shanghai';
        if (lower.includes('china')) return 'China';

        return destination;
    }

    private inferPlaceFromStep(stepName: string, fallbackDestination: string): string {
        const combined = `${fallbackDestination} ${stepName}`.toLowerCase();
        const has = (phrase: string) => combined.includes(phrase);
        const hasWord = (word: string) => new RegExp(`\\b${word}\\b`, 'i').test(combined);

        if (has('san francisco') || has('san fran') || has('san fransisco') || has('bay area') || hasWord('sf') || hasWord('sfo'))
            return 'San Francisco';
        if (has('singapore') || hasWord('sg')) return 'Singapore';
        if (has('new york') || has('nyc') || hasWord('ny')) return 'New York';
        if (has('tokyo')) return 'Tokyo';
        if (has('japan')) return 'Japan';
        if (has("xi'an") || has('xian')) return "Xi'an";
        if (has('beijing')) return 'Beijing';
        if (has('shanghai')) return 'Shanghai';
        if (has('china')) return 'China';

        return this.canonicalizeDestination(fallbackDestination);
    }

    private extractMonthYear(goal: string): { monthIndex: number | null; year: number | null } {
        const months = [
            'january',
            'february',
            'march',
            'april',
            'may',
            'june',
            'july',
            'august',
            'september',
            'october',
            'november',
            'december',
        ];
        const lower = goal.toLowerCase();
        const monthIndex = months.findIndex(m => lower.includes(m));
        const yearMatch = goal.match(/\b(20\d{2})\b/);
        const year = yearMatch ? Number(yearMatch[1]) : null;
        return { monthIndex: monthIndex >= 0 ? monthIndex : null, year };
    }

    private nextWeekday(from: Date, weekday: number): Date {
        const result = new Date(from);
        result.setHours(10, 0, 0, 0);
        const diff = (weekday - result.getDay() + 7) % 7;
        result.setDate(result.getDate() + (diff === 0 ? 7 : diff));
        return result;
    }

    private inferStartDate(goal: string): Date {
        const now = new Date();
        const { monthIndex, year } = this.extractMonthYear(goal);
        if (monthIndex === null) return this.nextWeekday(now, 6);

        const baseYear = year ?? (monthIndex < now.getMonth() ? now.getFullYear() + 1 : now.getFullYear());
        return this.nextWeekday(new Date(baseYear, monthIndex, 1), 6);
    }

    private formatDate(date: Date): string {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    private formatDateRange(start: Date, end: Date): string {
        const sameYear = start.getFullYear() === end.getFullYear();
        const startLabel = start.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: sameYear ? undefined : 'numeric',
        });
        const endLabel = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        return `${startLabel} - ${endLabel}`;
    }

    private buildDatesOutput(goal: string, durationDays: number) {
        const start = this.inferStartDate(goal);
        const end = new Date(start);
        end.setDate(end.getDate() + Math.max(3, durationDays) - 1);
        return {
            type: 'dates',
            recommendation: this.formatDateRange(start, end),
            reason: 'Matches your timeline and keeps weekends for travel.',
            startISO: start.toISOString(),
            endISO: end.toISOString(),
            days: durationDays,
        };
    }

    private async buildDatesOutputWithPriceInsights(params: { goal: string; durationDays: number; destination: string }) {
        const { goal, durationDays, destination } = params;
        const roughStart = this.inferStartDate(goal);
        const windowStart = new Date(roughStart);
        windowStart.setDate(1);
        windowStart.setHours(0, 0, 0, 0);

        const windowEnd = new Date(windowStart);
        windowEnd.setMonth(windowEnd.getMonth() + 3);

        let trend: Array<{ weekStart: Date; avgPrice: number; minPrice: number; maxPrice: number }> = [];
        try {
            await ensureSyntheticPriceSamples({
                destination,
                kind: 'flight',
                start: windowStart,
                days: 120,
            });
            trend = await flightPriceTrendByWeek({ destination, start: windowStart, end: windowEnd });
        } catch {
            trend = [];
        }
        const bestWeek = trend[0]?.weekStart ? new Date(trend[0].weekStart) : null;

        const start = bestWeek ? this.nextWeekday(bestWeek, 6) : roughStart;
        const end = new Date(start);
        end.setDate(end.getDate() + Math.max(3, durationDays) - 1);

        return {
            type: 'dates',
            recommendation: this.formatDateRange(start, end),
            reason:
                trend.length > 0
                    ? `Selected the lowest-average flight price week (~$${trend[0].avgPrice}).`
                    : 'Matches your timeline and keeps weekends for travel.',
            startISO: start.toISOString(),
            endISO: end.toISOString(),
            days: durationDays,
            priceTrend: trend.map(t => ({
                weekStartISO: new Date(t.weekStart).toISOString(),
                avgPrice: t.avgPrice,
                minPrice: t.minPrice,
                maxPrice: t.maxPrice,
            })),
        };
    }

    private buildFlightsOutput(destination: string) {
        const lower = destination.toLowerCase();
        const toAirport =
            lower.includes('japan') || lower.includes('tokyo')
                ? 'NRT'
                : lower.includes('singapore')
                    ? 'SIN'
                    : lower.includes('san francisco') || /\bsf\b/.test(lower)
                        ? 'SFO'
                        : lower.includes('beijing')
                            ? 'PEK'
                            : lower.includes('shanghai')
                                ? 'PVG'
                                : lower.includes('london') || lower.includes('uk') || lower.includes('england')
                                    ? 'LHR'
                                    : lower.includes('paris') || lower.includes('france')
                                        ? 'CDG'
                                        : lower.includes('new york') || lower.includes('nyc')
                                            ? 'JFK'
                                            : 'INTL';
        const route = `Home → ${toAirport === 'INTL' ? destination : toAirport}`;
        return {
            type: 'flights',
            options: [
                {
                    airline: lower.includes('japan') ? 'ANA' : 'United',
                    flight: lower.includes('japan') ? 'NH-107' : 'UA-882',
                    time: '10:10 AM',
                    route,
                    price: '$1,120',
                    duration: '11h 40m',
                },
                {
                    airline: lower.includes('japan') ? 'Japan Airlines' : 'Delta',
                    flight: lower.includes('japan') ? 'JL-001' : 'DL-249',
                    time: '02:35 PM',
                    route,
                    price: '$1,060',
                    duration: '12h 05m',
                },
            ],
            recommendedIndex: 1,
        };
    }

    private buildHotelsOutput(destination: string, durationDays: number) {
        const lower = destination.toLowerCase();
        const nights = Math.max(1, durationDays - 1);

        const mk = (name: string, area: string, nightlyUsd: number, notes: string) => ({
            name,
            area,
            nightlyUsd,
            totalUsd: nightlyUsd * nights,
            notes,
        });

        let options: Array<{ name: string; area: string; nightlyUsd: number; totalUsd: number; notes: string }> = [];
        let recommendedIndex = 0;

        if (lower.includes('san francisco') || /\bsf\b/.test(lower)) {
            options = [
                mk('Union Square / Downtown', 'Central, great for first-timers', 285, 'Best transit access; pick a well-reviewed block.'),
                mk('North Beach', 'Walkable, cafes + nightlife', 320, 'Easy access to Fisherman’s Wharf/Chinatown; lively evenings.'),
                mk('Marina / Cow Hollow', 'Scenic + calmer', 310, 'Great for Golden Gate access; fewer transit lines late night.'),
                mk('Mission / Valencia', 'Food + culture', 260, 'More local vibe; check noise levels and street safety at night.'),
            ];
            recommendedIndex = 0;
        } else if (lower.includes('singapore')) {
            options = [
                mk('Marina Bay', 'Iconic skyline + central', 380, 'Walkable to Gardens by the Bay; pricier but convenient.'),
                mk('Bugis', 'Great value + connected', 240, 'Near MRT lines; solid mid-range hotels.'),
                mk('Orchard', 'Shopping + easy transit', 310, 'Good base with lots of dining and MRT access.'),
                mk('Chinatown', 'Food + culture', 220, 'Great hawker access; check room size (often smaller).'),
            ];
            recommendedIndex = 1;
        } else if (lower.includes('new york') || lower.includes('nyc')) {
            options = [
                mk('Midtown', 'Central + transit hub', 340, 'Best for first visit; easy subway access.'),
                mk('Chelsea / Flatiron', 'Walkable + great food', 360, 'Close to High Line; great neighborhoods.'),
                mk('Lower Manhattan', 'Historic + views', 330, 'Great for Brooklyn Bridge and downtown sights.'),
                mk('Williamsburg (Brooklyn)', 'Trendy + lively', 290, 'Great vibe; quick subway to Manhattan.'),
            ];
            recommendedIndex = 0;
        } else {
            options = [
                mk('Downtown (central)', 'Closest to top sights', 250, 'Prioritize transit access and safety.'),
                mk('Old Town / Historic Center', 'Charming + walkable', 230, 'Great for culture and cafes.'),
                mk('Near Main Station', 'Most convenient for transport', 210, 'Good if you plan day trips.'),
            ];
            recommendedIndex = 0;
        }

        return {
            type: 'hotels',
            destination,
            nights,
            options,
            recommendedIndex,
        };
    }

    private buildTransportOutput(destination: string, stepName: string) {
        const lower = destination.toLowerCase();
        const step = stepName.toLowerCase();

        const mk = (mode: string, name: string, details: string, estimate?: string) => ({
            mode,
            name,
            details,
            estimate,
        });

        if (lower.includes('san francisco') || /\bsf\b/.test(lower)) {
            const options = [
                mk('Transit', 'Clipper Card', 'Tap-to-pay for Muni + BART + ferries. Add to Apple Wallet if supported.', '$'),
                mk('Transit', 'Muni (bus/metro) + cable cars', 'Great for city exploration; consider a 1–3 day Muni pass.', '$'),
                mk('Airport', 'BART from SFO', 'Fast ride to downtown; easiest transfer option.', '$'),
                mk('Ride-share', 'Uber/Lyft', 'Best late-night or for hills; surge pricing during events.', '$$'),
            ];
            return { type: 'transport', destination, options };
        }

        if (lower.includes('singapore')) {
            const options = [
                mk('Transit', 'EZ-Link / SimplyGo', 'Use MRT + buses; easiest for most travelers.', '$'),
                mk('Transit', 'Singapore Tourist Pass', 'Unlimited rides for short stays; compare vs pay-as-you-go.', '$'),
                mk('Ride-share', 'Grab', 'Very reliable for quick hops and late night.', '$$'),
                mk('Airport', 'MRT/Taxi from Changi', 'MRT is cheapest; taxi is easiest with luggage.', '$–$$'),
            ];
            return { type: 'transport', destination, options };
        }

        if (lower.includes('china') || lower.includes('beijing') || lower.includes('shanghai') || step.includes('intercity')) {
            const options = [
                mk('Transit', 'Metro + buses', 'Fast and cheap; get a transit card where available.', '$'),
                mk('Ride-share', 'DiDi', 'Best for point-to-point and late night.', '$$'),
                mk('Intercity', 'High-speed rail', 'Often the best Beijing ⇄ Xi’an ⇄ Shanghai option; book tickets early.', '$$'),
                mk('Airport', 'Airport Express / taxi', 'Use express lines where available; taxi for luggage.', '$–$$'),
            ];
            return { type: 'transport', destination, options };
        }

        return {
            type: 'transport',
            destination,
            options: [
                mk('Transit', 'Local metro/bus', 'Buy a transit card or use contactless where supported.', '$'),
                mk('Ride-share', 'Uber/Grab/taxi', 'Use for late nights and short hops.', '$$'),
                mk('Walk', 'Walkable core', 'Cluster sights by neighborhood to reduce travel time.', '$'),
            ],
        };
    }

    private buildActivitiesOutput(destination: string) {
        const lower = destination.toLowerCase();
        if (lower.includes('japan') || lower.includes('tokyo')) {
            return {
                type: 'events',
                items: [
                    { name: 'Shibuya Crossing & Shinjuku night walk', date: 'Day 1', type: 'City' },
                    { name: 'Meiji Shrine + Harajuku street food', date: 'Day 2', type: 'Culture' },
                    { name: 'Tsukiji Outer Market + sushi tasting', date: 'Day 3', type: 'Food' },
                    { name: 'Day trip: Hakone (onsen + Mt. Fuji views)', date: 'Day 4', type: 'Nature' },
                    { name: 'Kyoto: Fushimi Inari + Gion evening', date: 'Day 6', type: 'Culture' },
                    { name: 'Arashiyama bamboo grove + river area', date: 'Day 7', type: 'Nature' },
                    { name: 'Nara deer park day trip', date: 'Day 8', type: 'Day Trip' },
                    { name: 'Osaka: Dotonbori + street food crawl', date: 'Day 10', type: 'Food' },
                ],
            };
        }

        if (lower.includes('san francisco') || /\bsf\b/.test(lower)) {
            return {
                type: 'events',
                items: [
                    { name: 'Golden Gate Bridge + Presidio viewpoints', date: 'Day 1', type: 'Landmark' },
                    { name: 'Alcatraz (book ahead) + Fisherman’s Wharf stroll', date: 'Day 2', type: 'History' },
                    { name: 'Ferry Building + Embarcadero + waterfront sunset', date: 'Day 3', type: 'Food' },
                    { name: 'Mission District murals + Dolores Park picnic', date: 'Day 4', type: 'Culture' },
                    { name: 'Lands End trail + Sutro Baths', date: 'Day 5', type: 'Nature' },
                    { name: 'Chinatown + North Beach cafes', date: 'Day 6', type: 'Neighborhoods' },
                    { name: 'Day trip: Muir Woods / Sausalito', date: 'Day 7', type: 'Day Trip' },
                ],
            };
        }

        if (lower.includes('singapore')) {
            return {
                type: 'events',
                items: [
                    { name: 'Gardens by the Bay (Supertree Grove) at night', date: 'Day 1', type: 'Iconic' },
                    { name: 'Marina Bay promenade + skyline viewpoints', date: 'Day 2', type: 'City' },
                    { name: 'Hawker center crawl (Maxwell / Lau Pa Sat)', date: 'Day 3', type: 'Food' },
                    { name: 'Chinatown + Buddha Tooth Relic Temple', date: 'Day 4', type: 'Culture' },
                    { name: 'Little India + Kampong Glam (Haji Lane)', date: 'Day 5', type: 'Neighborhoods' },
                    { name: 'Sentosa (beach + attractions)', date: 'Day 6', type: 'Fun' },
                    { name: 'Jewel Changi + airport transit ease', date: 'Day 7', type: 'Bonus' },
                ],
            };
        }

        if (lower.includes('beijing')) {
            return {
                type: 'events',
                items: [
                    { name: 'Forbidden City + Tiananmen Square', date: 'Day 1', type: 'History' },
                    { name: 'Temple of Heaven + hutong walk', date: 'Day 2', type: 'Culture' },
                    { name: 'Great Wall day trip (Mutianyu/Badaling)', date: 'Day 3', type: 'Day Trip' },
                    { name: 'Summer Palace', date: 'Day 4', type: 'Nature' },
                ],
            };
        }

        if (lower.includes('shanghai')) {
            return {
                type: 'events',
                items: [
                    { name: 'The Bund at sunset + skyline views', date: 'Day 1', type: 'Iconic' },
                    { name: 'Yu Garden + Old City food', date: 'Day 2', type: 'Culture' },
                    { name: 'French Concession cafes + stroll', date: 'Day 3', type: 'Neighborhoods' },
                    { name: 'Shanghai Museum / People’s Square', date: 'Day 4', type: 'Culture' },
                ],
            };
        }

        if (lower.includes('china')) {
            return {
                type: 'events',
                items: [
                    { name: 'Beijing: Forbidden City + Great Wall day trip', date: 'Days 1–3', type: 'History' },
                    { name: 'Xi’an: Terracotta Army day trip', date: 'Day 4', type: 'Day Trip' },
                    { name: 'Shanghai: The Bund + French Concession', date: 'Days 5–6', type: 'City' },
                    { name: 'Food focus: regional specialties each city', date: 'Any day', type: 'Food' },
                ],
            };
        }

        return {
            type: 'events',
            items: [
                { name: 'City walking tour (old town + landmarks)', date: 'Day 1', type: 'Sightseeing' },
                { name: 'Top museum + local neighborhood exploration', date: 'Day 2', type: 'Culture' },
                { name: 'Food market + signature local dish tasting', date: 'Day 3', type: 'Food' },
                { name: 'Day trip to nearby nature/heritage site', date: 'Day 4', type: 'Day Trip' },
                { name: 'Live show / nightlife district', date: 'Day 5', type: 'Entertainment' },
                { name: 'Shopping + souvenir route', date: 'Day 6', type: 'Shopping' },
            ],
        };
    }

    private buildBudgetOutput(durationDays: number) {
        const flights = 1100;
        const hotels = Math.round(durationDays * 170);
        const foodAndActivities = Math.round(durationDays * 85);
        const total = flights + hotels + foodAndActivities;
        const format = (n: number) => `$${n.toLocaleString('en-US')}`;
        return {
            type: 'budget',
            total: format(total),
            breakdown: [
                { category: 'Flights', amount: format(flights) },
                { category: 'Hotels', amount: format(hotels) },
                { category: 'Food & Activities', amount: format(foodAndActivities) },
            ],
        };
    }

    private buildItineraryMarkdown(params: {
        goal: string;
        destination: string;
        durationDays: number;
        dates: any;
        flights: any;
        hotels: any;
        transport: any;
        activities: any;
    }): string {
        const { goal, destination, durationDays, dates, flights, hotels, transport, activities } = params;
        const flight = flights?.options?.[flights?.recommendedIndex ?? 0] ?? flights?.options?.[0];
        const flightLine = flight
            ? `- ${flight.route ? `${flight.route} • ` : ''}${flight.airline} ${flight.flight}${flight.time ? ` • ${flight.time}` : ''} • ${flight.duration} • ${flight.price}`
            : '- Add flights';
        const hotel = hotels?.options?.[hotels?.recommendedIndex ?? 0] ?? hotels?.options?.[0];
        const hotelLine = hotel
            ? `- ${hotel.name}${hotel.area ? ` • ${hotel.area}` : ''} • ~$${hotel.nightlyUsd}/night`
            : '- Choose accommodations';
        const transportLines: string[] =
            transport?.options?.slice(0, 4).map((o: any) => `- ${o.name}: ${o.details}`) ?? ['- Add local transport plan'];
        const activityLines: string[] =
            activities?.items?.slice(0, 6).map((a: any) => `- ${a.name}`) ?? ['- Add activities'];

        const dayCount = Math.min(Math.max(3, durationDays), 10);
        const startISO = dates?.startISO;
        const startDate = startISO ? new Date(startISO) : undefined;
        const days: string[] = [];
        for (let i = 0; i < dayCount; i += 1) {
            const labelDate = startDate ? this.formatDate(new Date(startDate.getTime() + i * 86400000)) : `Day ${i + 1}`;
            const activity = activities?.items?.[i % (activities?.items?.length ?? 1)]?.name ?? 'Explore the city';
            days.push(`### Day ${i + 1} (${labelDate})\n- ${activity}\n- Local food stop\n- Evening stroll / downtime`);
        }
        const more = durationDays > dayCount ? `\n\n_Repeat this pattern and adjust for rest days for the remaining ${durationDays - dayCount} days._` : '';

        return [
            `# Trip Plan`,
            ``,
            `**Goal:** ${goal}`,
            `**Destination:** ${destination}`,
            ``,
            `## Selected Dates`,
            `- ${dates?.recommendation ?? 'Choose dates'}`,
            dates?.reason ? `- ${dates.reason}` : null,
            ``,
            `## Flights (Recommended)`,
            flightLine,
            ``,
            `## Accommodation`,
            hotelLine,
            ``,
            `## Getting Around`,
            ...transportLines,
            ``,
            `## Must‑See & Activities`,
            ...activityLines,
            ``,
            `## Day‑by‑Day (Starter Itinerary)`,
            ...days,
            more,
        ]
            .filter(Boolean)
            .join('\n');
    }

    private async buildUserFacingOutput(args: {
        stepName: string;
        assignedAgent: string;
        goal: string;
        destination: string;
        durationDays: number;
        context: Record<string, any>;
        scheduledFor: Date;
        knowledge: Array<{ text: string; source: string; score?: number }>;
    }): Promise<{ output: any; contextPatch?: Record<string, any> }> {
        const name = args.stepName.toLowerCase();
        if (name.startsWith('wait:')) return { output: null };

        const agent = this.normalizeAgentName(args.assignedAgent);
        const place = this.inferPlaceFromStep(args.stepName, args.destination);
        const isFinalItineraryStep =
            args.stepName.trim().toLowerCase() === 'send final itinerary' || name.includes('final itinerary');

        const wantsItinerary = ['itinerary', 'schedule', 'day-by-day', 'day by day'].some(k => name.includes(k));
        const isDraftItineraryStep = wantsItinerary && !isFinalItineraryStep;
        const wantsFlights = ['flight', 'airfare', 'plane'].some(k => name.includes(k));
        const wantsDates = ['date', 'dates', 'when'].some(k => name.includes(k));
        const wantsHotels = ['hotel', 'hotels', 'accommod', 'lodging', 'stay', 'hostel', 'airbnb', 'apartment'].some(k =>
            name.includes(k)
        );
        const wantsTransport = [
            'transport',
            'transportation',
            'transit',
            'metro',
            'subway',
            'mrt',
            'bus',
            'train',
            'rideshare',
            'ride-share',
            'uber',
            'lyft',
            'taxi',
            'car rental',
            'rental car',
        ].some(k => name.includes(k));
        const wantsActivities = ['activity', 'activities', 'must-see', 'things to do', 'places', 'sights'].some(k =>
            name.includes(k)
        );
        const wantsBudget = ['budget', 'cost', 'spend'].some(k => name.includes(k));
        const wantsWeather = ['weather', 'pack'].some(k => name.includes(k));
        const wantsVisa = ['visa', 'entry requirement', 'passport'].some(k => name.includes(k));

        const contextPatch: Record<string, any> = {};

        // If a Research step mentions "itinerary", prefer activities/scenarios output over a full itinerary.
        if (agent === 'ResearchAgent' && wantsItinerary) {
            const activities = args.context.activities ?? this.buildActivitiesOutput(place);
            if (!args.context.activities) contextPatch.activities = activities;
            return { output: activities, contextPatch };
        }

        // Hide intermediate "draft" itinerary creation; only the final step should emit the itinerary.
        if (isDraftItineraryStep) {
            return { output: undefined };
        }

        if (wantsItinerary && isFinalItineraryStep) {
            const dates = args.context.dates ?? (await this.buildDatesOutputWithPriceInsights({
                goal: args.goal,
                durationDays: args.durationDays,
                destination: args.destination,
            }));
            const flights = args.context.flights ?? this.buildFlightsOutput(place);
            const hotels = args.context.hotels ?? this.buildHotelsOutput(place, args.durationDays);
            const transport = args.context.transport ?? this.buildTransportOutput(place, args.stepName);
            const activities = args.context.activities ?? this.buildActivitiesOutput(place);
            if (!args.context.dates) contextPatch.dates = dates;
            if (!args.context.flights) contextPatch.flights = flights;
            if (!args.context.hotels) contextPatch.hotels = hotels;
            if (!args.context.transport) contextPatch.transport = transport;
            if (!args.context.activities) contextPatch.activities = activities;

            const itineraryMarkdown = this.buildItineraryMarkdown({
                goal: args.goal,
                destination: place,
                durationDays: args.durationDays,
                dates,
                flights,
                hotels,
                transport,
                activities,
            });
            contextPatch.itineraryMarkdown = itineraryMarkdown;
            return { output: { type: 'markdown', itineraryMarkdown }, contextPatch };
        }

        if (wantsDates || (agent === 'Planner' && !args.context.dates)) {
            const dates = await this.buildDatesOutputWithPriceInsights({
                goal: args.goal,
                durationDays: args.durationDays,
                destination: args.destination,
            });
            contextPatch.dates = dates;
            return { output: dates, contextPatch };
        }

        if (wantsHotels || (agent === 'LogisticsAgent' && !args.context.hotels && wantsHotels)) {
            const hotels = this.buildHotelsOutput(place, args.durationDays);
            contextPatch.hotels = hotels;
            return { output: hotels, contextPatch };
        }

        if (wantsTransport || (agent === 'LogisticsAgent' && !args.context.transport && wantsTransport)) {
            const transport = this.buildTransportOutput(place, args.stepName);
            contextPatch.transport = transport;
            return { output: transport, contextPatch };
        }

        if (wantsFlights || (agent === 'LogisticsAgent' && !args.context.flights && wantsFlights)) {
            const flights = this.buildFlightsOutput(place);
            contextPatch.flights = flights;
            return { output: flights, contextPatch };
        }

        if (wantsActivities || (agent === 'ResearchAgent' && !args.context.activities)) {
            const activities = this.buildActivitiesOutput(place);
            contextPatch.activities = activities;
            return { output: activities, contextPatch };
        }

        if (wantsBudget || (agent === 'FinancialAgent' && !args.context.budget)) {
            const budget = this.buildBudgetOutput(args.durationDays);
            contextPatch.budget = budget;
            return { output: budget, contextPatch };
        }

        if (wantsWeather) {
            return {
                output: {
                    type: 'weather',
                    location: args.destination,
                    forecast: [
                        { date: 'Day 1', temp: 72, condition: 'Sunny' },
                        { date: 'Day 2', temp: 68, condition: 'Partly Cloudy' },
                        { date: 'Day 3', temp: 65, condition: 'Rain' },
                    ],
                },
            };
        }

        if (wantsVisa || agent === 'VisaAgent') {
            const markdown = [
                `## Visa & Entry Checklist`,
                `- Confirm passport validity (6+ months remaining)`,
                `- Check entry/visa requirements for ${args.destination}`,
                `- Prepare return ticket + accommodation proof`,
                `- Save digital + printed copies of documents`,
            ].join('\n');
            return { output: { type: 'markdown', markdown }, contextPatch: { visaChecklist: markdown } };
        }

        // No user-facing output for this step
        return { output: undefined };
    }

    private async retrieveStepKnowledge(params: { goal: string; destination: string; stepName: string }) {
        try {
            const query = `${params.goal}\n${params.stepName}`;
            return await searchKnowledgeVector({
                query,
                destination: params.destination,
                limit: 4,
            });
        } catch {
            return [];
        }
    }

    // Helper to submit a new workflow
    async createWorkflow(goal: string, steps: string[], context?: Record<string, any>) {
        const wf = await Workflow.create({ goal, key: uuidv4(), context: context ?? {} });
        const stepDocs = steps.map(s => ({
            workflowId: wf._id,
            name: s,
            status: StepStatus.PENDING
        }));
        await Step.insertMany(stepDocs);
        return wf;
    }
}
