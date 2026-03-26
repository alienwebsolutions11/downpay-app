// app/routes/hello.tsx
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

export const loader = async () => {
  // No database call here
  return json({ message: "Hello world! ✅" });
};

export default function Hello() {
  const data = useLoaderData<typeof loader>();
  return (
    <div style={{ textAlign: "center", marginTop: "50px" }}>
      <h1>{data.message}</h1>
    </div>
  );
}