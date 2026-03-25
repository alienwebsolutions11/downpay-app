import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";


// export async function getProductIdsByTags({ request, tags }) {
//   const { admin } = await authenticate.admin(request);

//   if (!tags || tags.length === 0) return [];

//   const tagQuery =
//     tags.length === 1
//       ? `tag:${tags[0]}`
//       : tags.map(t => `tag:${t}`).join(" OR ");

//   const QUERY = `
//     query ($query: String!) {
//       products(first: 250, query: $query) {
//         nodes { id }
//       }
//     }
//   `;

//   const res = await admin.graphql(QUERY, {
//     variables: {
//       query: `(${tagQuery}) AND status:active`,
//     },
//   });

//   const jsonRes = await res.json();
//   return jsonRes.data.products.nodes.map(p => p.id);
// }
// export async function getAllProductIds({ admin }) {
//     const QUERY = `
//       query getAllProducts($first: Int!) {
//         products(first: $first) {
//           nodes { id }
//         }
//       }
//     `;
//     const res = await admin.graphql(QUERY, { variables: { first: 250 } });
//     const data = await res.json();
//     return data.data.products.nodes.map(p => p.id);
// }

export async function getAllProductIds({ admin }) {
  let allIds = [];
  let hasNextPage = true;
  let endCursor = null;

  while (hasNextPage) {
    const QUERY = `
      query getAllProducts($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes { id }
        }
      }
    `;

    const res = await admin.graphql(QUERY, {
      variables: { first: 250, after: endCursor },
    });

    const data = await res.json();
    const products = data.data.products.nodes;
    allIds.push(...products.map(p => p.id));

    hasNextPage = data.data.products.pageInfo.hasNextPage;
    endCursor = data.data.products.pageInfo.endCursor;
  }

  return allIds;
}

export async function getProductIdsByTags({ request, tags }) {
  if (!tags || tags.length === 0) return [];

  const { admin } = await authenticate.admin(request);
  const tagQuery =
    tags.length === 1
      ? `tag:${tags[0]}`
      : tags.map(t => `tag:${t}`).join(" OR ");

  let allIds = [];
  let hasNextPage = true;
  let endCursor = null;

  while (hasNextPage) {
    const QUERY = `
      query getProductsByTags($query: String!, $first: Int!, $after: String) {
        products(first: $first, after: $after, query: $query) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes { id }
        }
      }
    `;

    const res = await admin.graphql(QUERY, {
      variables: {
        query: `(${tagQuery}) AND status:active`,
        first: 250,
        after: endCursor,
      },
    });

    const data = await res.json();
    allIds.push(...data.data.products.nodes.map(p => p.id));

    hasNextPage = data.data.products.pageInfo.hasNextPage;
    endCursor = data.data.products.pageInfo.endCursor;
  }

  return allIds;
}

// export async function getAllExistingPlanProducts(admin, planGroupId) {
//   let products = [];
//   let cursor = null;
//   let hasNext = true;                                                                                                                                                                                                                                                                                                                                                                                                                                       

//   while (hasNext) {
//     const res = await admin.graphql(
//       `
//       query ($id: ID!, $cursor: String) {
//         sellingPlanGroup(id: $id) {
//           products(first: 250, after: $cursor) {
//             nodes { id }
//             pageInfo {
//               hasNextPage
//               endCursor
//             }
//           }
//         }
//       }
//       `,
//       {
//         variables: {
//           id: planGroupId,
//           cursor,
//         },
//       }
//     );

//     const json = await res.json();
//     const page = json.data.sellingPlanGroup.products;

//     products.push(...page.nodes.map(p => p.id));
//     hasNext = page.pageInfo.hasNextPage;
//     cursor = page.pageInfo.endCursor;
//   }

//   return products;
// }

export async function getAllExistingPlanProducts(admin, planGroupId) {
  let products = [];
  let cursor = null;
  let hasNext = true;

  while (hasNext) {
    const res = await admin.graphql(
      `
      query ($id: ID!, $cursor: String) {
        sellingPlanGroup(id: $id) {
          products(first: 250, after: $cursor) {
            nodes { id }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
      `,
      {
        variables: {
          id: planGroupId,
          cursor,
        },
      }
    );

    const json = await res.json();

    // ✅ IMPORTANT GUARD
    if (!json.data?.sellingPlanGroup) {
      console.warn("Selling plan group not found in this store:", planGroupId);
      return []; // or throw a controlled error
    }

    const page = json.data.sellingPlanGroup.products;

    products.push(...page.nodes.map(p => p.id));
    hasNext = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }

  return products;
}


export async function getTotalProductCount({ shop, accessToken }) {
  const res = await fetch(
    `https://${shop}/admin/api/2024-10/products/count.json`,
    {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    }
  );

  const data = await res.json();
  return data.count; // ✅ total products
}

export const getShopBySellingPlanGroupId = (sellingPlanGroupId) => {
  return new Promise((resolve, reject) => {
    db.query(
      `SELECT shop 
       FROM purchase_table 
       WHERE selling_plan_group_id = ?
       LIMIT 1`,
      [sellingPlanGroupId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows[0]?.shop || null);
      }
    );
  });
};

export const action = async ({ request }) => {
  const body = await request.json();
  const productIds = await getProductIdsByTags({
    request,
    tags: body.tags,
  });

  return json({ productIds });
};

