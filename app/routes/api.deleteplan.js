
import axios from "axios";
import { authenticate } from "../shopify.server";


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
    (
      block.type === "@app" ||
      block.type.startsWith("app://apps/") ||
      block.type.startsWith("shopify://apps/")
    )
  ) {
    console.log("✅ REAL APP BLOCK FOUND:", block.type);
    return true;
  }
}

    }
  }
  return false;
}
