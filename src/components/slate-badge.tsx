'use client';

import { useState, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'om-badge-dismissed';

const subscribe = (callback: () => void) => {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
};

const getSnapshot = (): boolean => {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const getServerSnapshot = (): boolean => false;

export function SlateBadge() {
  const persistedDismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [visible, setVisible] = useState(true);
  const [localDismissed, setLocalDismissed] = useState(false);

  if (persistedDismissed || localDismissed) return null;

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(() => {
      try {
        sessionStorage.setItem(STORAGE_KEY, '1');
      } catch {
        /* ignore storage errors */
      }
      setLocalDismissed(true);
    }, 300);
  };

  return (
    <div className={`group fixed bottom-4 left-4 z-50 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}>
      <a
        href="https://console.in.om.ai"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Made with Om.AI"
        className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-xs font-medium text-foreground/70 shadow-sm backdrop-blur-md transition-colors hover:text-foreground hover:bg-background/90"
      >
        <svg width="14" height="14" viewBox="0 0 1024 1024" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M545.12 284.49L605.3 308.89C610.3 310.92 610.29 317.99 605.3 320.01L545.13 344.35C543.62 344.96 542.43 346.15 541.82 347.66L517.42 407.84C515.39 412.84 508.32 412.83 506.3 407.84L481.96 347.67C481.35 346.16 480.16 344.97 478.65 344.36L418.47 319.96C413.47 317.93 413.48 310.86 418.47 308.84L478.64 284.5C480.15 283.89 481.34 282.7 481.95 281.19L506.35 221.01C508.38 216.01 515.45 216.02 517.47 221.01L541.81 281.18C542.42 282.69 543.61 283.88 545.12 284.49ZM895.5 547.27C850.55 591.47 798.5 610.32 757.05 614.43C773.43 651.59 782 692.12 782 733.14C782 810.71 752.22 883.67 698.15 938.58C643.91 993.65 571.76 1023.99 494.97 1023.99C430.25 1023.99 369.3 1003.63 318.69 965.11C294.01 946.33 272.75 923.82 255.49 898.22C237.84 872.05 224.79 843.23 216.69 812.57C216.58 812.16 216.48 811.75 216.38 811.34C207.43 772.49 210.65 735.38 211.14 730.47C216.54 673.23 254.93 627.69 305.39 613.86C304.54 613.99 303.7 614.11 302.84 614.22C297.19 614.95 291.05 615.33 284.52 615.33C240.98 615.33 180.05 597.99 128.48 547.27C41.8398 462.08 42.4998 326.93 42.7398 314.91C42.7998 272.52 51.1398 231.37 67.5398 192.61C83.4298 155.05 106.16 121.33 135.11 92.38C164.06 63.43 197.78 40.7 235.34 24.81C274.26 8.35 315.56 0 358.12 0C412.44 0 465.13 13.77 512 40.03C558.87 13.77 611.56 0 665.88 0C708.44 0 749.74 8.34 788.65 24.8C826.21 40.69 859.93 63.42 888.88 92.37C917.83 121.32 940.56 155.04 956.45 192.6C972.85 231.36 981.19 272.51 981.25 314.9C981.49 326.92 982.14 462.07 895.51 547.26L895.5 547.27ZM839.41 490.23C902.6 428.09 901.31 319.07 901.26 316.44C901.25 316.03 901.25 315.8 901.25 315.37C901.25 252.5 876.77 193.39 832.31 148.94C787.85 104.48 728.75 80 665.88 80C618.74 80 573.27 93.88 534.38 120.13C520.86 129.26 503.14 129.26 489.62 120.13C450.73 93.88 405.26 80 358.12 80C295.25 80 236.14 104.48 191.69 148.94C147.23 193.4 122.75 252.5 122.75 315.37C122.75 315.8 122.75 316.03 122.74 316.44C122.69 319.08 121.4 428.09 184.59 490.23C226.22 531.16 273.48 537.33 292.66 534.87C314.44 532.07 330.87 513.33 330.87 491.28C330.87 467.04 311.15 447.32 286.91 447.32C284.12 447.32 281.35 447.58 278.65 448.09C276.14 448.56 273.64 448.79 271.18 448.79C252.33 448.79 235.55 435.41 231.92 416.21C227.82 394.5 242.09 373.58 263.8 369.48C271.38 368.05 279.15 367.32 286.91 367.32C355.26 367.32 410.87 422.93 410.87 491.28C410.87 547.63 372.7 596.33 319.69 610.85C325.6 609.97 331.63 609.52 337.76 609.52C370.48 609.52 400.29 622.18 422.57 642.85C444.85 622.18 474.66 609.52 507.38 609.52C576.2 609.52 632.19 665.51 632.19 734.33C632.19 803.15 595.82 853.93 529.77 883.2C524.5 885.54 519 886.64 513.58 886.64C498.24 886.64 483.61 877.77 476.99 862.84C468.04 842.64 477.15 819.01 497.35 810.06C546.5 788.27 552.19 756.4 552.19 734.33C552.19 709.62 532.09 689.52 507.38 689.52C482.67 689.52 462.57 709.62 462.57 734.33C462.57 756.42 444.66 774.33 422.57 774.33C400.48 774.33 382.57 756.42 382.57 734.33C382.57 709.62 362.47 689.52 337.76 689.52C322.96 689.52 312.74 696.66 306.78 702.65C297.75 711.72 292.07 724.29 290.79 738.05C290.78 738.2 290.78 738.19 290.77 738.3C290.65 739.7 288.34 766.72 294.22 792.79C305.9 836.46 331.11 874.03 367.16 901.47C403.72 929.3 447.92 944.01 494.98 944.01C609.14 944.01 702.01 849.42 702.01 733.16C702.01 696.69 692.74 660.8 675.2 629.31C668.63 618.88 651.39 591.95 642.12 579.35C621.5 551.3 615.36 515.19 614.73 511.17H614.74C613.69 504.68 613.14 498.05 613.14 491.3C613.14 422.95 668.75 367.34 737.1 367.34C744.86 367.34 752.63 368.07 760.21 369.5C781.92 373.6 796.19 394.52 792.09 416.23C787.99 437.94 767.06 452.21 745.36 448.11C742.67 447.6 739.89 447.34 737.1 447.34C712.86 447.34 693.14 467.06 693.14 491.3C693.14 513.34 709.58 532.08 731.37 534.89C750.53 537.34 797.79 531.18 839.42 490.25L839.41 490.23Z" />
        </svg>
        <span>Made with Om.AI</span>
      </a>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss badge"
        className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-border/60 bg-background text-foreground/50 opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
      >
        <svg width="6" height="6" viewBox="0 0 6 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <line x1="1" y1="1" x2="5" y2="5" />
          <line x1="5" y1="1" x2="1" y2="5" />
        </svg>
      </button>
    </div>
  );
}
