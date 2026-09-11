import * as dotenv from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';

dotenv.config();

const qdrant = new QdrantClient({ url: process.env.QDRANT_URL || 'http://localhost:6333' });

async function verify() {
    const collectionName = 'github_code_chunks';
    
    console.log('Connecting to Qdrant...');
    const info = await qdrant.getCollection(collectionName);
    console.log(`✅ Success! Total vectors stored: ${info.points_count}`);

    const result = await qdrant.scroll(collectionName, { limit: 1 });
    if (result.points.length > 0) {
        console.log('\n--- Sample Code Chunk Payload ---');
        console.log(JSON.stringify(result.points[0].payload, null, 2));
    }
}

verify().catch(console.error);