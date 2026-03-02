import {
  mapWorkforceUpstreamError,
  UpstreamAuthError,
  UpstreamConflictError,
  UpstreamForbiddenError,
  UpstreamNotFoundError,
  UpstreamUnavailableError,
} from '../errors';

describe('mapWorkforceUpstreamError', () => {
  test('maps 401/403/404/409', () => {
    expect(mapWorkforceUpstreamError({ statusCode: 401 })).toBeInstanceOf(UpstreamAuthError);
    expect(mapWorkforceUpstreamError({ statusCode: 403 })).toBeInstanceOf(UpstreamForbiddenError);
    expect(mapWorkforceUpstreamError({ statusCode: 404 })).toBeInstanceOf(UpstreamNotFoundError);
    expect(mapWorkforceUpstreamError({ statusCode: 409 })).toBeInstanceOf(UpstreamConflictError);
  });

  test('maps 5xx/timeout/unknown to Unavailable', () => {
    expect(mapWorkforceUpstreamError({ statusCode: 500 })).toBeInstanceOf(UpstreamUnavailableError);
    expect(mapWorkforceUpstreamError({ statusCode: undefined })).toBeInstanceOf(UpstreamUnavailableError);
  });
});
