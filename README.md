# Event Horizon: The "Forever" Travel Assistant ✈️

> **Problem Statement 1: Prolonged Coordination**
> An agentic system capable of performing intricate, multi-step workflows that last hours or days... enduring failures, restarts, and task modifications.

Event Horizon is a resilient, long-running agent engine backed by **MongoDB**. It is designed to manage tasks that span months (like waiting for visa windows) by "sleeping" and waking up exactly when needed.

## 🌟 Key Features

*   **Persistence**: Every step (input, output, logs) is saved to MongoDB. The process can crash, be killed, or redeployed, and it will resume exactly where it left off.
*   **Time Travel Scheduling**: The agent respects `scheduledFor` timestamps. It can "wait 3 months" by going idle and only unlocking the next step when the time arrives.
*   **Sequential Locking**: Enforces strict step order using a `BLOCKED` / `PENDING` state machine to prevent race conditions.

## 🛠️ Setup

1.  **Install Dependencies**
    ```bash
    npm install
    ```

2.  **Configure Environment**
    Create a `.env` file with your MongoDB Atlas URI:
    ```bash
    MONGODB_URI=mongodb+srv://user:pass@cluster...
    ```

## 🚀 How to Run the Demo

We have included a `demo.sh` script to make showcasing the resilience easy.

### The "Happy Path"
Run the full simulation (Find Flights -> Wait -> Apply for Visa -> Wait -> Book Hotels):

```bash
./demo.sh
```

### The "Resilience" Test (Chaos Monkey)
Prove that the agent survives process death:

1.  Run `./demo.sh`.
2.  Wait until you see: `🕒 Encountered WAIT instruction. Sleeping...`
3.  **Kill the process** (`Ctrl + C`).
4.  Restart the engine manually:
    ```bash
    npm start
    ```
5.  **Result**: The agent checks MongoDB, sees the wait is still active (or finished), and resumes the workflow without restarting from zero.

## 📂 Project Structure

*   `src/core/engine.ts`: The heart of the system. Manages the loop, state recovery, and step execution.
*   `src/db/schema.ts`: Mongoose schemas defining the rigid structure needed for resilience.
*   `src/travel_workflow.ts`: A script to seed the database with a "Japan Trip" workflow.

---
*Built for the MongoDB SF Hackathon 2026*