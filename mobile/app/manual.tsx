import ManualScreen from '../src/screens/ManualScreen';
import { useNav } from '../src/oneNav';

export default function Manual() {
  return <ManualScreen navigation={useNav()} />;
}
