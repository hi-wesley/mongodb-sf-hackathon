# Event Horizon: The "Forever" Travel Assistant ✈️

> **Problem Statements Addressed:**
> 1. **Prolonged Coordination**: Agents that "live forever," sleeping for months waiting on real-world events (visas, dates).
> 2. **Multi-Agent Collaboration**: Specialized personas (VisaBot, ResearchAgent, FinancialAgent) working together.
> 3. **Explainable AI**: Visualizing the "thought process" and data retrieval of agents in real-time.

Event Horizon is a **Resilient Agentic Platform** backed by MongoDB. It features a Cybernetic React Dashboard where users can spin up complex travel missions and watch agents collaborate, plan, and execute tasks over simulated logic.

## 🌟 Key Features

*   **Persistence**: Process crashing? No problem. MongoDB stores every thought.
*   **Time Travel**: Agents respect `scheduledFor` and go dormant until needed.
*   **Multi-Agent Personas**: Watch "VisaAgent" and "LogisticsAgent" hand off tasks.
*   **Visual Dashboard**: A cybernetic UI built with Vite + Tailwind + Framer Motion.
*   **Generative Planning**: Powered by **GPT-5 Nano** for fast, cost-effective workflow generation.

## 🛠️ Stack

*   **Runtime**: Node.js + TypeScript
*   **Database**: MongoDB Atlas (State Store)
*   **Backend**: Express API (Port 3000)
*   **Frontend**: React + Vite + Tailwind (Port 5173)

## 🚀 Getting Started

### 1. Backend Setup
Create a `.env` file with your keys:
```bash
MONGODB_URI=mongodb+srv://...
OPENAI_API_KEY=sk-...
```

Start the API Server:
```bash
# Installs dependencies and starts server on :3000
npm install
npm start
```
*(Note: `npm start` now runs `npx tsx src/server.ts`)*

### 2. Frontend Setup
Launch the Dashboard:
```bash
cd client
npm install
npm run dev
```
Open **http://localhost:5173** in your browser.

## 🎮 How to Demo

1.  Open the Dashboard.
2.  Type a request: **"Plan a 2 week trip to Mars in 2050"**.
3.  Click **Launch**.
4.  **Watch Magic Happen**:
    *   **Planner** (GPT-5 Nano) generates the JSON plan.
    *   **LogisticsAgent** books the rocket.
    *   **VisaAgent** goes to sleep for "5 years" (simulated as seconds).
    *   **ResearchAgent** refines search queries (visualized in logs).

## 🚀 Run the Full Demo

You need **two terminal windows** open to run the full experience.

### Terminal 1: The Brain (Backend)
Start the API server to handle logic, AI planning, and state recovery.
```bash
npm start
```
*Runs on http://localhost:3000*

### Terminal 2: The Visuals (Frontend)
Start the dashboard to see the agents in action.
```bash
cd client && npm run dev
```
*Runs on http://localhost:5173* (Open this link in your browser!)

5.  **Kill the Backend**: Stop the `npm start` process.
6.  **Restart Backend**: Run `npm start` again.
7.  **Witness Resurrection**: The dashboard reconnects, and the agent picks up *exactly* where it left off!

---
*Built for the MongoDB SF Hackathon 2026*