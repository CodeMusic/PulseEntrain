import { useParams } from 'one';
import StudioScreen from '../src/screens/StudioScreen';
import { useNav } from '../src/oneNav';

// Web-only authoring (`/studio`). On native it renders a "use the web" notice —
// the editor isn't meant for a phone form factor (and the desktop Admin covers
// native authoring for now). `?load=<id>` opens a catalog dose in the editor.
export default function Studio() {
  const params = useParams() as any;
  const route = { params: { load: params.load != null ? String(params.load) : undefined } };
  return <StudioScreen navigation={useNav()} route={route} />;
}
