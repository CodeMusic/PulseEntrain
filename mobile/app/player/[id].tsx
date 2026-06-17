import { useParams } from 'one';
import PlayerScreen from '../../src/screens/PlayerScreen';
import { useNav } from '../../src/oneNav';

export default function Player() {
  const params = useParams();
  const route = {
    params: {
      id: decodeURIComponent(String(params.id ?? '')),
      // booleans arrive as query strings ('1' / '0')
      usePulsetto: params.usePulsetto === '1',
      useNova: params.useNova === '1',
    },
  };
  return <PlayerScreen navigation={useNav()} route={route} />;
}
