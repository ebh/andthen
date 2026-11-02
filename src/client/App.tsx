import { useRoute } from "./router";
import { NewStory } from "./pages/NewStory";
import { NotFound } from "./pages/NotFound";
import { Story } from "./pages/Story";

export function App() {
  const route = useRoute();

  return page(route);
}

function page(route: ReturnType<typeof useRoute>) {
  if (route.type === "new_story") {
    return <NewStory />;
  }
  if (route.type === "story") {
    return <Story key={route.storyId} storyId={route.storyId} />;
  }

  return <NotFound message="There's nothing at this address." />;
}
