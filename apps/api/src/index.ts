import express from 'express';
import cors from 'cors';
import { QdrantClient } from '@qdrant/js-client-rest';
import { GoogleGenAI } from '@google/genai';
import { PrismaClient } from '@prisma/client';
import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import 'dotenv/config';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 4000;
const qdrant = new QdrantClient({ url: process.env.QDRANT_URL || 'http://localhost:6333' });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY});

app.use(cors());
app.use(express.json());

// Initialize the Redis connection for the queue
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null
});

// Create a queue instance
const indexingQueue = new Queue('indexingQueue', { connection });

// Create queue events instance
const queueEvents = new QueueEvents('indexingQueue', { connection });

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Test the database connection
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

app.post('/api/index', async (req, res) => {
    const { githubUrl } = req.body;
    if (!githubUrl) {
        return res.status(400).json({ error: 'githubUrl is required' });
    }

    try {
        // Add the repository URL as a job to the Redis queue
        const job = await indexingQueue.add('indexRepo', { githubUrl });

        // Respond immediately to the frontend, don't wait for indexing to finish
        res.status(202).json({
            message: 'Repository successfully queued for indexing',
            jobId: job.id
        });
    } catch (error) {
        console.error('Error queuing repository for indexing:', error);
        res.status(500).json({ error: 'Failed to queue repository for indexing' });
    }
});

app.post('/api/chat', async (req, res) => {
    const { githubUrl, messages } = req.body;
    try {
        
        if (!githubUrl || !messages || messages.length === 0) {
            return res.status(400).json({ error: "Both 'githubUrl' and 'question' are required." });
        }

        // The actual query to embed for vector search is just the latest question
        const latestQuestion = messages[messages.length - 1].content;

        // 1. Initialize Server-Sent Events (SSE) headers so we can stream progress OR the answer
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // 2. Check if the repo exists in Qdrant FIRST
        let isIndexed = false;
        try {
            const repoCheck = await qdrant.scroll('github_code_chunks', {
                filter: { must: [{ key: 'repoUrl', match: { value: githubUrl } }] },
                limit: 1
            });
            if (repoCheck.points.length > 0) {
                isIndexed = true;
            }
        } catch (error) {
            // If the collection doesn't exist yet, Qdrant throws an error.
            // We catch it here and safely assume the repo hasn't been indexed.
            console.log(`Collection missing or error checking ${githubUrl}. Triggering worker...`);
        }

        // 3. If no chunks exist, trigger the worker and tell the user to wait
        if (!isIndexed) {
            res.write(`data: ${JSON.stringify({ type: 'text', data: '### 🔄 Initializing Repository Indexing...\n' })}\n\n`);

            const job = await indexingQueue.add('index-repo', { githubUrl });

            await new Promise((resolve, reject) => {
                const onProgress = (args: any) => {
                    if(args.jobId === job.id) {
                        res.write(`data: ${JSON.stringify({ type: 'text', data: `> Progress: ${args.data}%\n\n` })}\n\n`);
                    }
                };
                const onCompleted = (args: any) => {
                    if(args.jobId === job.id) {
                        cleanup();
                        resolve(true);
                    }
                };
                const onFailed = (args: any) => {
                    if(args.jobId === job.id) {
                        cleanup();
                        reject(new Error(args.failedReason));
                    }
                };
                const cleanup = () => {
                    queueEvents.off('progress', onProgress);
                    queueEvents.off('completed', onCompleted);
                    queueEvents.off('failed', onFailed);
                };
                queueEvents.on('progress', onProgress);
                queueEvents.on('completed', onCompleted);
                queueEvents.on('failed', onFailed);
            });

            res.write(`data: ${JSON.stringify({ type: 'text', data: '\n\n ✅ **Indexing Complete! Analyzing codebase for your answer...**\n\n---\n\n' })}\n\n`);
        }
        
        // 4. Convert the user's question into a search vector
        let queryVector: number[];
        try {
            const queryEmbedding = await ai.models.embedContent({
                model: 'gemini-embedding-2',
                contents: latestQuestion,
                config: { outputDimensionality: 768 }
            });

            if (!queryEmbedding.embeddings || queryEmbedding.embeddings.length === 0) {
                throw new Error('No embeddings returned');
            }
            queryVector = queryEmbedding.embeddings[0].values!;
        }
        catch (error: any) {
            console.error('Error generating query embedding:', error);

            const isRateLimit = error?.status === 429 || error?.message?.includes('429');
            const errorMessage = isRateLimit
                ? 'Gemini API quota exceeded. Please wait a minute before asking another question.'
                : 'Failed to generate embedding for your question.';

            // Send error message through the open SSE stream and cleanly terminate
            res.write(`data: ${JSON.stringify({ type: 'text', data: `\n\n⚠️ **Error:** ${errorMessage}\n\n` })}\n\n`);
            res.write(`data: [DONE]\n\n`);
            res.end();
            return;
        }
        

        // 5. Search Qdrant for the most relevant code chunks from that specific repo
        const searchResponse = await qdrant.query('github_code_chunks', {
            query: queryVector,
            limit: 15,
            with_payload: true,
            filter: {
                must: [
                    { key: "repoUrl", match: { value: githubUrl } }
                ]
            }
        });

        // 6. Format the retrieved chunks into a context string
        const contextStr = searchResponse.points.map(point => {
            const p = point.payload as Record<string, any>;
            return `File: ${p.filePath}\nLines: ${p.startLine}-${p.endLine}\nCode:\n${p.content}`;
        }).join('\n\n---\n\n');

        // 7. Format the conversation history for Gemini
        const formattedContents = messages.map((msg: any) => ({
            role: msg.role,
            parts: [{ text: msg.content }]
        }));

        // 8. Inject the Qdrant context into the most recent user question
        const lastIndex = formattedContents.length - 1;
        const originalQuestion = formattedContents[lastIndex].parts[0].text;

        formattedContents[lastIndex].parts[0].text = `You are an expert developer assistant answering questions about a codebase. 
Use the following retrieved code snippets to answer the user's question. 
If the answer is not contained in the provided code, say so. Do not invent code.

Code Context:
${contextStr}

User Question: ${originalQuestion}`;

        // 9. Stream the entire conversation array to Gemini
        const responseStream = await ai.models.generateContentStream({
            model: 'gemini-2.5-flash',
            contents: formattedContents
        });

        

        // Extract sources and send them as the first stream event
        const sources = searchResponse.points.map(s => (s.payload as Record<string, any>).filePath);
        res.write(`data: ${JSON.stringify({ type: 'sources', data: sources })}\n\n`);

        // Iterate over the AI stream and send chunks as they arrive
        for await (const chunk of responseStream) {
            if (chunk.text) {
                res.write(`data: ${JSON.stringify({ type: 'text', data: chunk.text })}\n\n`);
            }
        }

        res.end();

    } catch (error) {
        console.error("Chat error:", error);
        if(res.headersSent) {
            res.write(`data: ${JSON.stringify({ type: 'data', data: '\n\n**[System: Connection interrupted. The AI encountered an error or rate limit.]**' })}\n\n`);
            res.end();
        }
        else {
            res.status(500).json({ error: "Failed to process chat request" });
        }
    }
});

app.listen(PORT, () => {
  console.log(`🚀 API Server running on http://localhost:${PORT}`);
});