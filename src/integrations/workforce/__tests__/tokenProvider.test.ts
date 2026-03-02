import { KeycloakClientCredentialsTokenProvider } from '../tokenProvider';

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('KeycloakClientCredentialsTokenProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('caches token until exp-30s', async () => {
    let nowMs = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);

    const fetchMock = jest.fn(async () =>
      makeJsonResponse(200, { access_token: 't1', expires_in: 60 })
    );
    global.fetch = fetchMock;

    const provider = new KeycloakClientCredentialsTokenProvider({
      keycloakBaseUrl: 'https://kc',
      realm: 'naliv-prod',
      clientId: 'bm',
      clientSecret: 'secret',
      timeoutMs: 1000,
    });

    const token1 = await provider.getToken();
    expect(token1).toBe('t1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    nowMs = 29_000;
    const token2 = await provider.getToken();
    expect(token2).toBe('t1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    nowMs = 31_000;
    const token3 = await provider.getToken();
    expect(token3).toBe('t1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('is concurrency-safe (single refresh in-flight)', async () => {
    let resolveFetch: ((res: Response) => void) | null = null;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = jest.fn(() => fetchPromise);
    global.fetch = fetchMock;

    const provider = new KeycloakClientCredentialsTokenProvider({
      keycloakBaseUrl: 'https://kc',
      realm: 'naliv-prod',
      clientId: 'bm',
      clientSecret: 'secret',
      timeoutMs: 1000,
    });

    const p1 = provider.getToken();
    const p2 = provider.getToken();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch!(makeJsonResponse(200, { access_token: 't1', expires_in: 60 }));
    const [t1, t2] = await Promise.all([p1, p2]);
    expect(t1).toBe('t1');
    expect(t2).toBe('t1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
