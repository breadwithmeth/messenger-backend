import {
  generateWebsiteSessionToken,
  hashWebsiteSessionToken,
  websiteSessionTokenMatches,
} from '../websiteWidgetService';

describe('websiteWidgetService', () => {
  test('hashes and verifies opaque session tokens', () => {
    const token = generateWebsiteSessionToken();
    const hash = hashWebsiteSessionToken(token);

    expect(token).not.toEqual(hash);
    expect(websiteSessionTokenMatches(token, hash)).toBe(true);
    expect(websiteSessionTokenMatches(`${token}x`, hash)).toBe(false);
  });
});
