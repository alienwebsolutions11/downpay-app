import { json } from "@remix-run/node";

export const action = async ({ request }) => {
  const body = await request.json();
  const productIds = await getProductIdsByTags({
    request,
    tags: body.tags,
  });

  return json({ productIds });
};

