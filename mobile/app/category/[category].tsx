import { useParams, Stack } from 'one';
import CategoryScreen from '../../src/screens/CategoryScreen';
import { useNav } from '../../src/oneNav';

export default function Category() {
  const { category } = useParams();
  const name = decodeURIComponent(String(category ?? ''));
  return (
    <>
      {/* set the header title to the category name (overrides the layout default) */}
      <Stack.Screen options={{ title: name || 'Programs' }} />
      <CategoryScreen navigation={useNav()} route={{ params: { category: name } }} />
    </>
  );
}
