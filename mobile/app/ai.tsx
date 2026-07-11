import AiSessionScreen from '../src/screens/AiSessionScreen';
import { useNav } from '../src/oneNav';

export default function Ai() {
  return <AiSessionScreen navigation={useNav()} />;
}
