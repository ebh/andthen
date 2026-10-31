import { navigate } from "../router";

interface NotFoundProps {
  message: string;
}

export function NotFound({ message }: NotFoundProps) {
  return (
    <div className="flex flex-col items-start gap-3">
      <h2 className="text-2xl font-bold">Not found</h2>
      <p>{message}</p>
      <a
        href="/"
        className="btn btn-primary"
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
