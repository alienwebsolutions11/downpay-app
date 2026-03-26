// app/routes/app._index.jsx
import { Link } from "@remix-run/react";

export default function AppIndex() {
  return (
    <div>
      <h1>Hello, this is a test page!</h1>
      <p>No database needed.</p>
      <Link to="/">Go home</Link>
    </div>
  );
}