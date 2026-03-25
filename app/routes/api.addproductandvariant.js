import { json } from "@remix-run/node";
import axios from "axios";
import { authenticate } from "../shopify.server";

export async function action({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;
    const accessToken = session.accessToken;
console.log("final_Access",accessToken);
    const body = await request.json();

    const {
      sellingPlanGroupId,
      productIds = [],
      variantIds = [],
    } = body;

    if (!sellingPlanGroupId) {
      return json(
        { success: false, error: "Missing sellingPlanGroupId" },
        { status: 400 }
      );
    }

    if (!productIds.length && !variantIds.length) {
      return json(
        { success: false, error: "No products or variants provided" },
        { status: 400 }
      );
    }

    let userErrors = [];

    // ADD PRODUCTS
    if (productIds.length) {
      const res = await axios.post(
        `https://${shop}/admin/api/2025-10/graphql.json`,
        {
          query: `
            mutation addProducts($id: ID!, $productIds: [ID!]!) {
              sellingPlanGroupAddProducts(id: $id, productIds: $productIds) {
                userErrors { field message }
              }
            }
          `,
          variables: {
            id: sellingPlanGroupId,
            productIds,
          },
        },
        {
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          },
        }
      );

      userErrors.push(
        ...res.data.data.sellingPlanGroupAddProducts.userErrors
      );
    }

    // ADD VARIANTS
    if (variantIds.length) {
      const res = await axios.post(
        `https://${shop}/admin/api/2025-10/graphql.json`,
        {
          query: `
            mutation addVariants($id: ID!, $variantIds: [ID!]!) {
              sellingPlanGroupAddProductVariants(
                id: $id,
                productVariantIds: $variantIds
              ) {
                userErrors { field message }
              }
            }
          `,
          variables: {
            id: sellingPlanGroupId,
            variantIds,
          },
        },
        {
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          },
        }
      );

      userErrors.push(
        ...res.data.data.sellingPlanGroupAddProductVariants.userErrors
      );
    }

    return json({
      success: true,
      userErrors,
    });
  } catch (err) {
    console.error("❌ addproductandvariant error:", err);

    return json(
      {
        success: false,
        error: err.message || "Internal server error",
      },
      { status: 500 }
    );
  }
}
