import SplashScreen from '../src/screens/SplashScreen';
import { useNav } from '../src/oneNav';

export default function Index() {
  return <SplashScreen navigation={useNav()} />;
}
