import { WorkforceClient } from '../workforceClient';

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('WorkforceClient (mock HTTP happy paths)', () => {
  test('sync + shift start/stop use service token header', async () => {
    const tokenProvider = { getToken: jest.fn(async () => 'SERVICE_TOKEN') };
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const u = new URL(url);

      if (u.pathname.endsWith('/internal/employees/sync') && init?.method === 'POST') {
        return makeJsonResponse(200, { id: 'e1', keycloakId: 'kc1', email: 'a@b.c' });
      }
      if (u.pathname.endsWith('/internal/employees/kc1') && init?.method === 'GET') {
        return makeJsonResponse(200, { id: 'e1', keycloakId: 'kc1' });
      }
      if (u.pathname.endsWith('/internal/employees/e1/shifts/start') && init?.method === 'POST') {
        return makeJsonResponse(200, { id: 's1', employeeId: 'e1', startedAt: '2026-01-01T00:00:00Z' });
      }
      if (u.pathname.endsWith('/internal/employees/e1/shifts/stop') && init?.method === 'POST') {
        return makeJsonResponse(200, { id: 's1', employeeId: 'e1', startedAt: '2026-01-01T00:00:00Z', stoppedAt: '2026-01-01T01:00:00Z' });
      }

      return makeJsonResponse(404, { error: 'not found' });
    });

    const client = new WorkforceClient({
      config: { baseUrl: 'https://emp', timeoutMs: 50, retryCount: 0, retryBaseDelayMs: 1 },
      tokenProvider,
      fetchImpl,
    });

    await client.syncEmployee({ keycloakId: 'kc1', email: 'a@b.c' }, { requestId: 'r1' });
    const employee = await client.getEmployeeByKeycloakId('kc1', { requestId: 'r1' });
    await client.startShift(employee.id, { requestId: 'r1' });
    await client.stopShift(employee.id, { requestId: 'r1' });

    expect(tokenProvider.getToken).toHaveBeenCalled();

    // Ensure we never forward user JWT; only service token in Authorization
    for (const c of calls) {
      const auth = (c.init?.headers as any)?.authorization;
      expect(auth).toBe('Bearer SERVICE_TOKEN');
    }
  });
});
