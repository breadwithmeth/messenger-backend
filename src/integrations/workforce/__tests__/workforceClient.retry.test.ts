import { WorkforceClient } from '../workforceClient';
import { UpstreamNotFoundError } from '../errors';

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('WorkforceClient retry policy', () => {
  test('retries on network error', async () => {
    const tokenProvider = { getToken: jest.fn(async () => 'SERVICE') };
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(makeJsonResponse(200, { ok: true }));

    const client = new WorkforceClient({
      config: { baseUrl: 'https://emp', timeoutMs: 50, retryCount: 2, retryBaseDelayMs: 1 },
      tokenProvider,
      fetchImpl,
    });

    const res = await (client as any).request({ method: 'GET', path: '/internal/employees', ctx: { requestId: 'r' } });
    expect(res).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('retries on 5xx but not on 4xx', async () => {
    const tokenProvider = { getToken: jest.fn(async () => 'SERVICE') };

    const fetch5xx = jest
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(500, { error: 'oops' }))
      .mockResolvedValueOnce(makeJsonResponse(200, { ok: true }));
    const client5xx = new WorkforceClient({
      config: { baseUrl: 'https://emp', timeoutMs: 50, retryCount: 2, retryBaseDelayMs: 1 },
      tokenProvider,
      fetchImpl: fetch5xx,
    });
    const ok = await (client5xx as any).request({ method: 'GET', path: '/internal/employees', ctx: {} });
    expect(ok).toEqual({ ok: true });
    expect(fetch5xx).toHaveBeenCalledTimes(2);

    const fetch4xx = jest.fn().mockResolvedValueOnce(makeJsonResponse(404, { error: 'no' }));
    const client4xx = new WorkforceClient({
      config: { baseUrl: 'https://emp', timeoutMs: 50, retryCount: 2, retryBaseDelayMs: 1 },
      tokenProvider,
      fetchImpl: fetch4xx,
    });
    await expect(
      (client4xx as any).request({ method: 'GET', path: '/internal/employees/x', ctx: {} })
    ).rejects.toBeInstanceOf(UpstreamNotFoundError);
    expect(fetch4xx).toHaveBeenCalledTimes(1);
  });

  test('retries on timeout (AbortError)', async () => {
    const tokenProvider = { getToken: jest.fn(async () => 'SERVICE') };

    const fetchImpl = jest
      .fn()
      .mockImplementationOnce((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const e: any = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        })
      )
      .mockResolvedValueOnce(makeJsonResponse(200, { ok: true }));

    const client = new WorkforceClient({
      config: { baseUrl: 'https://emp', timeoutMs: 1, retryCount: 2, retryBaseDelayMs: 1 },
      tokenProvider,
      fetchImpl,
    });

    const res = await (client as any).request({ method: 'GET', path: '/internal/employees', ctx: {} });
    expect(res).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
