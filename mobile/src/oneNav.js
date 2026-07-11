import { useRouter } from 'one';

// Maps the old React-Navigation screen names + params onto One's path-based
// router, so the existing screens can keep calling navigation.navigate(...)
// without being rewritten. One screen file = one route below.
export function pathFor(screen, params = {}) {
  switch (screen) {
    case 'Splash':
      return '/';
    case 'Springboard':
      return '/springboard';
    case 'Manual':
      return '/manual';
    case 'Field':
      return '/field';
    case 'Ai':
      return '/ai';
    case 'Studio':
      return params && params.load ? `/studio?load=${encodeURIComponent(params.load)}` : '/studio';
    case 'About':
      return '/about';
    case 'Settings':
      return '/settings';
    case 'Category':
      return `/category/${encodeURIComponent(params.category)}`;
    case 'DoseDetail':
      return `/dose/${encodeURIComponent(params.id)}`;
    case 'Player': {
      const q = new URLSearchParams();
      if (params.usePulsetto != null) q.set('usePulsetto', params.usePulsetto ? '1' : '0');
      if (params.useNova != null) q.set('useNova', params.useNova ? '1' : '0');
      if (params.strength != null) q.set('strength', String(params.strength)); // chosen base strength
      const qs = q.toString();
      return `/player/${encodeURIComponent(params.id)}${qs ? `?${qs}` : ''}`;
    }
    default:
      return '/';
  }
}

// A drop-in shim for the `navigation` prop the screens expect.
export function useNav() {
  const router = useRouter();
  return {
    navigate: (screen, params) => router.push(pathFor(screen, params)),
    push: (screen, params) => router.push(pathFor(screen, params)),
    replace: (screen, params) => router.replace(pathFor(screen, params)),
    goBack: () => router.back(),
    canGoBack: () => (router.canGoBack ? router.canGoBack() : true),
    // Header options are configured centrally in app/_layout.tsx; screens that
    // called setOptions for the title are no-ops here.
    setOptions: () => {},
  };
}
