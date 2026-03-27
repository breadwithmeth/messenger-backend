import pino from 'pino';
import { JobsOptions, Queue, QueueEvents, Worker } from 'bullmq';
import { bitrixService } from './bitrix.service';
import { BitrixSyncPayload } from './bitrix.types';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const QUEUE_NAME = 'bitrix-sync';
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

let queue: Queue<BitrixSyncPayload> | null = null;
let queueEvents: QueueEvents | null = null;
let worker: Worker<BitrixSyncPayload> | null = null;

if (!connection) {
  logger.warn('[BitrixQueue] REDIS_URL is not configured. Queue is disabled, fallback to inline processing.');
}

function getQueue(): Queue<BitrixSyncPayload> | null {
  if (!connection) {
    return null;
  }

  if (!queue) {
    queue = new Queue<BitrixSyncPayload>(QUEUE_NAME, {
      ...connection,
      defaultJobOptions,
    });
  }

  return queue;
}

export async function enqueueBitrixSync(messageId: string): Promise<void> {
  const queueRef = getQueue();
  if (!queueRef) {
    // Fallback: process immediately without Redis
    setImmediate(async () => {
      try {
        await bitrixService.syncMessage(String(messageId));
      } catch (error: any) {
        logger.error({ messageId, message: error?.message }, '[BitrixQueue] Inline sync failed');
      }
    });
    return;
  }

  await queueRef.add('sync-message', { messageId: Number(messageId) }, { jobId: `bitrix-message-${messageId}` });
}

export async function startBitrixWorker(): Promise<void> {
  if (!connection || worker) {
    // no-op when Redis is absent
    return;
  }

  worker = new Worker<BitrixSyncPayload>(
    QUEUE_NAME,
    async (job) => {
      await bitrixService.syncMessage(String(job.data.messageId));
    },
    {
      ...connection,
      concurrency: 5,
    },
  );

  queueEvents = new QueueEvents(QUEUE_NAME, connection);

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, messageId: job.data.messageId }, '[BitrixQueue] Job completed');
  });

  worker.on('failed', (job, error) => {
    logger.error(
      {
        jobId: job?.id,
        messageId: job?.data?.messageId,
        attemptsMade: job?.attemptsMade,
        message: error.message,
      },
      '[BitrixQueue] Job failed',
    );
  });

  queueEvents.on('error', (error) => {
    logger.error({ message: error.message }, '[BitrixQueue] Queue events error');
  });

  logger.info('[BitrixQueue] Worker started');
}

export async function stopBitrixWorker(): Promise<void> {
  await worker?.close();
  await queueEvents?.close();
  await queue?.close();

  worker = null;
  queueEvents = null;
  queue = null;
}
