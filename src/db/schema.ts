import mongoose, { Schema, Document } from 'mongoose';

export enum WorkflowStatus {
    PENDING = 'PENDING',
    RUNNING = 'RUNNING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
}

export enum StepStatus {
    PENDING = 'PENDING',
    RUNNING = 'RUNNING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    BLOCKED = 'BLOCKED',
}

export interface IWorkflow extends Document {
    goal: string;
    status: WorkflowStatus;
    currentStepIndex: number;
    context: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

export interface IStep extends Document {
    workflowId: mongoose.Types.ObjectId;
    name: string;
    status: StepStatus;
    input: any;
    output: any;
    retryCount: number;
    logs: string[];
    assignedAgent: string;
    retrievalContext?: any;
    scheduledFor: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface IKnowledgeChunk extends Document {
    text: string;
    source: string;
    tags: {
        destination?: string;
        topic?: string;
    };
    embedding?: number[];
    createdAt: Date;
    updatedAt: Date;
}

const WorkflowSchema: Schema = new Schema({
    goal: { type: String, required: true },
    status: { type: String, enum: Object.values(WorkflowStatus), default: WorkflowStatus.PENDING },
    currentStepIndex: { type: Number, default: 0 },
    context: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });

const StepSchema: Schema = new Schema({
    workflowId: { type: Schema.Types.ObjectId, ref: 'Workflow', required: true },
    name: { type: String, required: true },
    status: { type: String, enum: Object.values(StepStatus), default: StepStatus.PENDING },
    input: { type: Schema.Types.Mixed },
    output: { type: Schema.Types.Mixed },
    retryCount: { type: Number, default: 0 },
    logs: [{ type: String }],
    assignedAgent: { type: String, default: 'System' },
    retrievalContext: { type: Schema.Types.Mixed }, // Store vector search results/thoughts here
    scheduledFor: { type: Date, default: Date.now },
}, { timestamps: true });

const KnowledgeChunkSchema: Schema = new Schema(
    {
        text: { type: String, required: true },
        source: { type: String, required: true },
        tags: {
            destination: { type: String },
            topic: { type: String },
        },
        embedding: [{ type: Number }],
    },
    { timestamps: true }
);

export const Workflow = mongoose.model<IWorkflow>('Workflow', WorkflowSchema);
export const Step = mongoose.model<IStep>('Step', StepSchema);
export const KnowledgeChunk = mongoose.model<IKnowledgeChunk>('KnowledgeChunk', KnowledgeChunkSchema, 'knowledge_chunks');
