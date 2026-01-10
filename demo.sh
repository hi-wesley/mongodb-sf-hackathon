#!/bin/bash

# Stop on error
set -e

USER_PROMPT="$1"

echo "🚀 Preparing the 'Forever' Travel Assistant Demo..."

if [ -z "$USER_PROMPT" ]; then
    echo "🌱 Seeding database with static 'Japan Trip'..."
    # Default static demo
    npx tsx src/travel_workflow.ts
    
    echo "---------------------------------------------------"
    echo "📋 Scenario (Static): "
    echo "   1. Find Flights (Immediate)"
    echo "   2. WAIT 1s (Simulating 3 months wait)"
    echo "   3. Apply for Visa"
    echo "   4. WAIT 1s (Simulating approval)"
    echo "   5. Book Hotels"

else
    echo "🧠 Seeding database with AI plan for: '$USER_PROMPT'..."
    # Dynamic demo
    npx tsx src/dynamic_workflow.ts "$USER_PROMPT"
fi

echo "---------------------------------------------------"
echo "✅ Seeding Complete. The Agent is ready."
echo "💡 TIP: To test resilience, press Ctrl+C while it's 'sleeping', then run 'npm start' to resume!"
echo "---------------------------------------------------"
echo "🌌 Starting the Event Horizon Engine..."
npm start
