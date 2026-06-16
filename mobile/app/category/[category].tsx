import { useParams } from 'one';
import CategoryScreen from '../../src/screens/CategoryScreen';
import { useNav } from '../../src/oneNav';

export default function Category() {
  const { category } = useParams();
  return (
    <CategoryScreen
      navigation={useNav()}
      route={{ params: { category: decodeURIComponent(String(category ?? '')) } }}
    />
  );
}
