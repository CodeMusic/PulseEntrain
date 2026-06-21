import { useEffect, useState } from 'react';

// Web phone orientation via the browser DeviceOrientation API.
//   pitch   = beta  (front/back tilt: phone flat ≈ 0, top edge up → positive)
//   heading = compass azimuth (0–360; iOS exposes true heading via
//             webkitCompassHeading, else derived from alpha)
export const PHONE_SUPPORTED =
  typeof window !== 'undefined' && !!(window as any).DeviceOrientationEvent;

export function usePhoneOrientation(active: boolean) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    if (!active || !PHONE_SUPPORTED) return;
    let on = true;
    const handler = (e: any) => {
      if (!on) return;
      const pitch = e.beta != null ? e.beta : 0;
      const heading =
        e.webkitCompassHeading != null ? e.webkitCompassHeading : e.alpha != null ? 360 - e.alpha : 0;
      setData({ pitch, heading });
    };
    const start = () => window.addEventListener('deviceorientation', handler, true);
    const DOE: any = (window as any).DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      DOE.requestPermission().then((p: string) => p === 'granted' && start()).catch(() => {});
    } else {
      start();
    }
    return () => {
      on = false;
      window.removeEventListener('deviceorientation', handler, true);
    };
  }, [active]);
  return data;
}
