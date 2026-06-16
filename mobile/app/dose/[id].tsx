import { useParams } from 'one';
import DoseDetailScreen from '../../src/screens/DoseDetailScreen';
import { useNav } from '../../src/oneNav';

export default function Dose() {
  const { id } = useParams();
  return (
    <DoseDetailScreen
      navigation={useNav()}
      route={{ params: { id: decodeURIComponent(String(id ?? '')) } }}
    />
  );
}
