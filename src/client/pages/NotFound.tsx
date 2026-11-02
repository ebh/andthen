import { navigate } from "../router";

interface NotFoundProps {
  message: string;
}

export function NotFound({ message }: NotFoundProps) {
  return (
    <div className="flex flex-col items-start gap-3">
      <h2 className="font-story text-2xl font-semibold">Not found</h2>
      <p>{message}</p>
      <a
        href="/"
        className="btn btn-primary min-h-11"
        onClick={(event) => {
          event.preventDefault();
          navigate("/");
        }}
      >
        Start a new story
      </a>
    </div>
  );
}
