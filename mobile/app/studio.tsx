import StudioScreen from '../src/screens/StudioScreen';
import { useNav } from '../src/oneNav';

// Web-only authoring (`/studio`). On native it renders a "use the web" notice —
// the editor isn't meant for a phone form factor (and the desktop Admin covers
// native authoring for now).
export default function Studio() {
  return <StudioScreen navigation={useNav()} />;
}
