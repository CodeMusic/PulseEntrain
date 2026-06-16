import SpringboardScreen from '../src/screens/SpringboardScreen';
import { useNav } from '../src/oneNav';

export default function Springboard() {
  return <SpringboardScreen navigation={useNav()} />;
}
