import { navigate, useRoute } from "./router";
import { NewStory } from "./pages/NewStory";
import { NotFound } from "./pages/NotFound";
import { Story } from "./pages/Story";

export function App() {
  const route = useRoute();

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-4">
      <header>
        <a
          href="/"
          className="text-3xl font-bold"
          onClick={(event) => {
            event.preventDefault();
            navigate("/");
          }}
        >
          And then…
        </a>
      </header>
      <main className="flex flex-col gap-4">{page(route)}</main>
    </div>
  );
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
