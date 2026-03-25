import { json } from "@remix-run/node";
import axios from "axios";
import { authenticate } from "../shopify.server"; // adjust path if needed

export const action = async ({ request }) => {
  console.log("SellingPlanGroupUpdate route hit");

 
  const session_final = await authenticate.admin(request);
  const shop_token = session_final.session.accessToken;
  const shop = session_final.session.shop;

  let body;
  try {
    body = await request.json();
    console.log("Incoming Request Body:", body);
  } catch (err) {
    console.error("Invalid JSON:", err);
    return json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { sellingPlanGroupId, sellingPlanId, name, checkoutAmount, 
    checkoutPercentage, } = body;

  if (!sellingPlanGroupId) {
    return json(
      { success: false, error: "Missing sellingPlanGroupId" },
      { status: 400 }
    );
  }

  try {
    const query = `
      mutation sellingPlanGroupUpdate(
        $id: ID!,
        $input: SellingPlanGroupInput!
      ) {
        sellingPlanGroupUpdate(id: $id, input: $input) {
          sellingPlanGroup {
            id
            name
            sellingPlans(first: 10) {
              edges {
                node {
                  id
                  name
                  
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

const variables = {
  id: planRow.selling_plan_group_id,
  input: {
    ...(formData.get("lineItemText") && { name: formData.get("lineItemText") }),
    
    ...(planRow.selling_plan_id && {
      sellingPlansToUpdate: [
        {
          id: planRow.selling_plan_id,
          name: formData.get("lineItemText"),
          billingPolicy: {
            fixed: {
              checkoutCharge,
              ...remainingBalanceConfig
            }
          }
        }
      ]
     
    }),
    
  }
};

// const variables = {
//   id: planRow.selling_plan_group_id,
//   input: {
//     ...(formData.get("lineItemText") && { name: formData.get("lineItemText") }),
//     ...(planRow.selling_plan_id && {
//       sellingPlansToUpdate: [
//         {
//           id: planRow.selling_plan_id,
//           name: formData.get("lineItemText"), // <-- new plan name
       
//         }
//       ]
//     })
//   }
// };

    console.log("GraphQL Variables:", variables);

    const response = await axios.post(
      `https://${shop}/admin/api/2025-10/graphql.json`,
      { query, variables },
      {
        headers: {
          "X-Shopify-Access-Token": shop_token,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(" Shopify Response:", response.data);

    const result = response.data.data?.sellingPlanGroupUpdate;

    if (result?.userErrors?.length) {
      console.error("Shopify userErrors:", result.userErrors);
      return json(
        { success: false, errors: result.userErrors },
        { status: 400 }
      );
    }

    return json({
      success: true,
      sellingPlanGroup: result.sellingPlanGroup,
    });
  } catch (error) {
    console.error(" Shopify API Error:", error.response?.data || error.message);
    return json(
      { success: false, error: "Shopify API error" },
      { status: 500 }
    );
  }
};
