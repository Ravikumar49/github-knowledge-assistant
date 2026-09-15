import * as dotenv from 'dotenv';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { simpleGit } from 'simple-git';
import { QdrantClient } from '@qdrant/js-client-rest';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { error } from 'console';
import { getSourceFiles, chunkFile } from './chunker';

dotenv.config(); // Load environment variables from .env file
// Initialize the Redis connection
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    // Required by BullMQ for ioredis connections to prevent stalling
    maxRetriesPerRequest: null 
});
const qdrant = new QdrantClient({ url: process.env.QDRANT_URL || 'http://localhost:6333' });
const git = simpleGit();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Create the background worker listening to the 'indexingQueue'
const indexingWorker = new Worker('indexingQueue', async (job) => {
    const { githubUrl } = job.data;
    console.log(`[JOB STARTED] Indexing repository: ${githubUrl}`);

    // Initialize the AI client here, right before we need it
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("CRITICAL: GEMINI_API_KEY is missing from the environment.");
    }
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Create a temporary directory for cloning the repository
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `repo-${job.id}-`));
    console.log(`[Job ${job.id}] Cloning repository into: ${tempDir}`);
    
    try {
        // Step 1: Clone the repository to a temporary local directory
        // We use a shallow clone (--depth1) because fetching just the latest commit allows for a much faster and lighter download.
        // It consumes significantly less disk space and bandwidth, which is critical for a background worker that frequently pulls data.
        await git.clone(githubUrl, tempDir, ['--depth', '1', '--single-branch']);
        console.log(`[Job ${job.id}] Successfully cloned repository: ${githubUrl}`);
        await job.updateProgress(20); // Update progress to 20% after cloning
        // Step 2: Iterate through the files and generate AST chunks
        const sourceFiles = getSourceFiles(tempDir);
        console.log(`[Job ${job.id}] Found ${sourceFiles.length} source code files.`);
        let allChunks = [];
        for (const file of sourceFiles) {
            const relativePath = path.relative(tempDir, file);
            const fileChunks = chunkFile(file, relativePath);
            allChunks.push(...fileChunks);
        }
        console.log(`[Job ${job.id}] Generated ${allChunks.length} AST chunks.`);
        await job.updateProgress(50); // Update progress to 50% after chunking
        // Ensure the Qdrant collection exists for 768-dimensional Gemini embeddings
        const collectionName = 'github_code_chunks';
        const { collections } = await qdrant.getCollections();
        const collectionExists = collections.some(c => c.name === collectionName);
        
        if (!collectionExists) {
            await qdrant.createCollection(collectionName, {
                vectors: { size: 768, distance: 'Cosine' }
            });
            console.log(`[Job ${job.id}] Created Qdrant collection: ${collectionName}`);
        }

        console.log(`[Job ${job.id}] Starting Gemini vector embedding for ${allChunks.length} chunks...`);
        const qdrantPoints = [];

        // Step 3: Embed each chunk using Gemini
        for (let i = 0; i < allChunks.length; i++) {
            const chunk = allChunks[i];
            try {
                const response = await ai.models.embedContent({
                    model: 'gemini-embedding-2',
                    contents: chunk.chunkContent,
                    config: {
                        outputDimensionality: 768
                    }
                });
                
                // Step 4: Prepare the payload for Qdrant
                if (response.embeddings?.[0]?.values) {
                    qdrantPoints.push({
                        id: crypto.randomUUID(),
                        vector: response.embeddings[0].values,
                        payload: {
                            repoUrl: githubUrl,
                            filePath: chunk.filePath,
                            startLine: chunk.startLine,
                            endLine: chunk.endLine,
                            content: chunk.chunkContent,
                            type: chunk.type
                        }
                    });
                }
                
                // Log progress to avoid an unresponsive terminal
                if ((i + 1) % 50 === 0) {
                    console.log(`[Job ${job.id}] Embedded ${i + 1}/${allChunks.length} chunks...`);
                }

                
                // Optional: Brief delay to respect free-tier Gemini API rate limits
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (err) {
                console.error(`[Job ${job.id}] Failed to embed ${chunk.filePath}:`, err);
            }
        }

        await job.updateProgress(100); // Update progress to 100% after embedding

        // Upsert all successfully embedded chunks into Qdrant
        if (qdrantPoints.length > 0) {
            await qdrant.upsert(collectionName, { wait: true, points: qdrantPoints });
            console.log(`[JOB COMPLETED] Successfully saved ${qdrantPoints.length} vectors to Qdrant.`);
        }
    }
    catch (error) {
        console.error(`[JOB FAILED] Error during indexing:`, error);
        throw error; // Rethrow to mark the job as failed
    }
    finally {
        // Clean up the temporary directory after processing
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log(`[Job ${job.id}] Cleaned up temporary directory: ${tempDir}`);
    }

    console.log(`[Job ${job.id}] Successfully indexed and embedded.`);
}, { 
    connection,
    concurrency: 1 // Process one repository at a time to respect Gemini API rate limits
});

indexingWorker.on('completed', (job) => {
    console.log(`✅ Job ${job.id} has been completed`);
});

indexingWorker.on('failed', (job, err) => {
    console.error(`❌ Job ${job?.id} failed: ${err.message}`);
});

console.log('👷 Background worker is running and listening for queue events...');