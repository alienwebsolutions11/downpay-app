import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import axios from "axios";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);

  const response = await axios.post(
    `https://${session.shop}/admin/api/2025-10/graphql.json`,
    {
   query: `
{
  orders(first: 20, sortKey: CREATED_AT, reverse: true) {
    edges {
      node {
        id
        name
        createdAt
       totalPriceSet {
  shopMoney {
    amount
    currencyCode
  }
}

        lineItems(first: 10) {
          edges {
            node {
              title
              quantity
              sellingPlan {
                name
                sellingPlanId
              }
            }
          }
        }
      }
    }
  }
}
`,

    },
    {
      headers: {
        "X-Shopify-Access-Token": session.accessToken,
        "Content-Type": "application/json",
      },
    }
  );

  // ✅ FILTER HERE
const orders =
  response.data?.data?.orders?.edges
    ?.map(({ node }) => {

      const subscriptionItem = node.lineItems.edges.find(
        ({ node }) => node.sellingPlan !== null
      )?.node;

      if (!subscriptionItem) return null;

      return {
        order_name:node.name,
       order_id: node.id.split("/").pop(),
       shop: session.shop,
        product_title: subscriptionItem.title,
        quantity: subscriptionItem.quantity,
        purchase_option_name: subscriptionItem.sellingPlan?.name || "",
        
        created_at: node.createdAt,
        order_amount: node.totalPriceSet?.shopMoney?.amount
   ? `${node.totalPriceSet.shopMoney.amount} ${node.totalPriceSet.shopMoney.currencyCode}`
   : "",
      };
    })
    .filter(Boolean) || [];

console.log("Filtered Orders:", orders);


  return json(orders);
}




