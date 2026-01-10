import dotenv from 'dotenv';
import { EventHorizon } from './core/engine';

dotenv.config();

async function main() {
    const engine = new EventHorizon();

    // Handle graceful shutdown
    const shutdown = async () => {
        console.log('Shutting down...');
        await engine.stop();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
        await engine.start();
    } catch (err) {
        console.error('Fatal error:', err);
        process.exit(1);
    }
}

main();
