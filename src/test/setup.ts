import '@testing-library/jest-dom';

// Mock Notification API (not available in jsdom)
class MockNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn().mockResolvedValue('default' as NotificationPermission);
  constructor(_title: string, _options?: NotificationOptions) {}
  close = vi.fn();
}

Object.defineProperty(window, 'Notification', {
  value: MockNotification,
  writable: true,
});

// Mock matchMedia (not available in jsdom)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Clear localStorage before each test
beforeEach(() => {
  localStorageMock.clear();
});
