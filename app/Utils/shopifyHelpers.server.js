import { authenticate } from "../shopify.server";
import axios from "axios";

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


export async function deleteSellingPlanGroup({
  shop,
  accessToken,
  sellingPlanGroupId,
}) {
  const query = `
    mutation sellingPlanGroupDelete($id: ID!) {
      sellingPlanGroupDelete(id: $id) {
        deletedSellingPlanGroupId
        userErrors {
          field
          message
        }
      }
    }
  `;

  const response = await axios.post(
    `https://${shop}/admin/api/2025-10/graphql.json`,
    {
      query,
      variables: { id: sellingPlanGroupId },
    },
    {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    }
  );

  const result = response.data?.data?.sellingPlanGroupDelete;

  if (result?.userErrors?.length) {
    throw new Error(result.userErrors[0].message);
  }

  return result.deletedSellingPlanGroupId;
}

export async function isThemeBlockActive({ shop, accessToken }) {
  const headers = {
    "X-Shopify-Access-Token": accessToken,
    "Content-Type": "application/json",
  };

  /* -------------------------------
     1️⃣ Get published (main) theme
  -------------------------------- */
  const themeRes = await fetch(
    `https://${shop}/admin/api/2024-10/themes.json?role=main`,
    { headers }
  );

  const themeData = await themeRes.json();
  const themeId = themeData.themes?.[0]?.id;

  if (!themeId) {
    console.log("❌ No main theme found");
    return false;
  }

  /* -------------------------------
     2️⃣ Get ALL theme assets
  -------------------------------- */
  const assetsRes = await fetch(
    `https://${shop}/admin/api/2024-10/themes/${themeId}/assets.json`,
    { headers }
  );

  const assetsData = await assetsRes.json();
  const assets = assetsData.assets || [];

  /* -------------------------------
     3️⃣ ONLY look at templates/*.json
     (THIS IS THE FIX)
  -------------------------------- */
  const templateKeys = assets
    .map((a) => a.key)
    .filter(
      (key) => key.startsWith("templates/") && key.endsWith(".json")
    );



  /* -------------------------------
     4️⃣ Read each template and find app blocks
  -------------------------------- */
  for (const key of templateKeys) {
    const templateRes = await fetch(
      `https://${shop}/admin/api/2024-10/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(
        key
      )}`,
      { headers }
    );

    const templateData = await templateRes.json();
    const value = templateData.asset?.value;

    if (!value) continue;

    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch (err) {
      console.log("❌ JSON parse failed:", key);
      continue;
    }

    const sections = parsed.sections || {};

    for (const section of Object.values(sections)) {
      const blocks = section.blocks || {};
for (const block of Object.values(blocks)) {
if (
  typeof block.type === "string" &&
  block.type.includes("/blocks/")
) {
  console.log("✅ REAL APP BLOCK FOUND:", block.type);
  return true;
} {
    console.log("✅ REAL APP BLOCK FOUND:", block.type);
    return true;
  }
}

    }
  }
  return false;
}
