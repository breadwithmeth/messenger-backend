import {
  generateWebsiteSessionToken,
  hashWebsiteSessionToken,
  normalizeWebsiteVisitorProfile,
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

  test('normalizes a partial visitor profile update', () => {
    expect(normalizeWebsiteVisitorProfile({
      name: '  Иван  ',
      email: '',
    })).toEqual({
      name: 'Иван',
      email: null,
    });
  });

  test('requires at least one supported profile field', () => {
    expect(() => normalizeWebsiteVisitorProfile({ city: 'Алматы' })).toThrow(
      'Передайте хотя бы одно поле'
    );
  });
});
