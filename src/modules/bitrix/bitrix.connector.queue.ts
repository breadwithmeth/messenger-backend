import pino from 'pino';
import { JobsOptions, Queue, QueueEvents, Worker } from 'bullmq';
import { bitrixConnectorService } from './bitrix.connector.service';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const QUEUE_NAME = 'bitrix-connector-send';
const redisUrl = process.env.REDIS_URL;

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: {
    age: 3600,
    count: 1000,
  },
  removeOnFail: {
    age: 86400,
    count: 1000,
  },
};

const connection = redisUrl
  ? {
      connection: {
        url: redisUrl,
      },
    }
  : null;

let queue: Queue<{ messageId: number }> | null = null;
let worker: Worker<{ messageId: number }> | null = null;
let queueEvents: QueueEvents | null = null;

if (!connection) {
  logger.warn('[BitrixConnectorQueue] REDIS_URL is not configured. Using inline processing.');
}

function getQueue(): Queue<{ messageId: number }> | null {
  if (!connection) return null;
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { ...connection, defaultJobOptions });
  }
  return queue;
}

export async function enqueueBitrixConnector(messageId: number): Promise<void> {
  const q = getQueue();
  if (!q) {
    setImmediate(async () => {
      try {
        await bitrixConnectorService.sendToBitrix(messageId);
      } catch (error: any) {
        logger.error({ messageId, message: error?.message }, '[BitrixConnectorQueue] Inline send failed');
      }
    });
    return;
  }

  await q.add('send', { messageId }, { jobId: `bitrix-connector-${messageId}` });
}

export async function startBitrixConnectorWorker(): Promise<void> {
  if (!connection || worker) return;

  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      await bitrixConnectorService.sendToBitrix(job.data.messageId);
    },
    { ...connection, concurrency: 5 },
  );

  queueEvents = new QueueEvents(QUEUE_NAME, connection);

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, '[BitrixConnectorQueue] Job completed');
  });

  worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, message: error?.message }, '[BitrixConnectorQueue] Job failed');
  });
}

export async function stopBitrixConnectorWorker(): Promise<void> {
  await worker?.close();
  await queueEvents?.close();
  await queue?.close();
  worker = null;
  queueEvents = null;
  queue = null;
}
