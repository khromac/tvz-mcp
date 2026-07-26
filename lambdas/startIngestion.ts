import {
  BedrockAgentClient,
  StartIngestionJobCommand,
} from '@aws-sdk/client-bedrock-agent';

// klijent se inicijalizira izvan handlera kako bi se ponovno koristio izmedu poziva
const client = new BedrockAgentClient({ region: process.env.REGION });
const KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID;
const DATA_SOURCE_ID = process.env.DATA_SOURCE_ID;

export const handler = async (_event: any): Promise<void> => {
  try {
    // pokrecemo sinkronizaciju baze znanja nakon promjene u S3 bucketu
    const res = await client.send(
      new StartIngestionJobCommand({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        dataSourceId: DATA_SOURCE_ID,
        description: 'Automatska sinkronizacija nakon S3 promjene',
      })
    );

    console.warn('Ingestion job pokrenut:', res.ingestionJob?.ingestionJobId);
  } catch (err: any) {
    if (err?.name === 'ConflictException') {
      // job u tijeku ionako skenira cijeli bucket na pocetku; kasnije datoteke
      // hvata sljedeci trigger, pa se ovdje samo vracamo bez greske
      console.warn('Ingestion job vec u tijeku, preskacem pokretanje');
      return;
    }

    // rethrow → S3 async invoke retry + vidljivost u metrikama
    console.error('StartIngestionJob nije uspio:', err);
    throw err;
  }
};
