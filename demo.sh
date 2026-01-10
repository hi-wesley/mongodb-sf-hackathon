#!/bin/bash

# Stop on error
set -e

echo "🚀 Preparing the 'Forever' Travel Assistant Demo..."
echo "🌱 Seeding database with a fresh Trip Workflow..."
# This deletes old data and creates a new trip
npx tsx src/travel_workflow.ts

echo "---------------------------------------------------"
echo "✅ Seeding Complete. The Agent is ready."
echo "---------------------------------------------------"
echo "📋 Scenario: "
echo "   1. Find Flights (Immediate)"
echo "   2. WAIT 1s (Simulating 3 months wait for Visa window)"
echo "   3. Apply for Visa (After wait)"
echo "   4. WAIT 1s (Simulating approval time)"
echo "   5. Book Hotels"
echo "---------------------------------------------------"
echo "💡 TIP: To test resilience, press Ctrl+C while it's 'sleeping', then run 'npm start' to resume!"
echo "---------------------------------------------------"
echo "🌌 Starting the Event Horizon Engine..."
npm start
