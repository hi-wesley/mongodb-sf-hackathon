# Event Horizon: The "Forever" Travel Assistant ✈️

> **Problem Statements Addressed:**
> 1. **Prolonged Coordination**: Agents that "sleep" for months waiting on real-world events.
> 2. **Multi-Agent Collaboration**: Specialized agents (VisaBot, ResearchAgent) collaborating on tasks.
> 3. **Adaptive Retrieval**: Visualizing the agent "thinking" and refining queries.

Event Horizon is a resilient, long-running agent engine backed by **MongoDB**. It features a modern **React Dashboard** to visualize agents working, sleeping, and planning in real-time.

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
5.  **Kill the Backend**: Stop the `npm start` process.
6.  **Restart Backend**: Run `npm start` again.
7.  **Witness Resurrection**: The dashboard reconnects, and the agent picks up *exactly* where it left off!

---
*Built for the MongoDB SF Hackathon 2026*