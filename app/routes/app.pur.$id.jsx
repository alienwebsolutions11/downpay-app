import {
  Box, Card, Layout, Link, Listbox, Page, Text, InlineStack,
  TextField, BlockStack, Button, RadioButton, Checkbox, Banner,
  DatePicker, Popover, Combobox, Tag, Thumbnail, Badge, Divider, Modal
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

import db from "../Utils/db.createserver";
import { TitleBar } from "@shopify/app-bridge-react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useFetcher, useLoaderData, Outlet } from "@remix-run/react";
import { redirect } from "@remix-run/node";
import { useState, useCallback, useMemo, useEffect } from "react";
import { getAllProductIds,  getAllExistingPlanProducts} from "../Utils/shopifyHelpers.server";
import {deleteSellingPlanGroup} from "../Utils/shopifyHelpers.server"
import { useNavigation } from "@remix-run/react";


function chunkArray(arr, size = 250) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
const GET_PRODUCT_TAGS = `
  query getProductTags($cursor: String) {
    products(first: 250, after: $cursor) {
      edges {
        node {
          tags
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

async function fetchAllShopTags(admin) {
  let hasNextPage = true;
  let cursor = null;
  const tagSet = new Set();

  while (hasNextPage) {
    const res = await admin.graphql(GET_PRODUCT_TAGS, {
      variables: { cursor },
    });

    const json = await res.json();
    const products = json.data.products;

    products.edges.forEach(({ node }) => {
      node.tags.forEach(tag => tagSet.add(tag));
    });

    hasNextPage = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;
  }

  return Array.from(tagSet).sort();
}


async function fetchTitlesByIds(admin, ids) {
  if (!ids.length) return {};

  const query = `
    query getNodes($ids: [ID!]!) {
      nodes(ids: $ids) {
        id

        ... on Product {
          title
          status
          featuredImage {
            url
          }
        }

        ... on ProductVariant {
          title
        
          image {
            url
          }
          product {
          id
          status
            title
            featuredImage {
              url
            }
          }
        }
      }
    }
  `;

  const response = await admin.graphql(query, {
    variables: { ids },
  });

  const json = await response.json();

  const map = {};
  for (const node of json.data.nodes) {
    if (!node) continue;
    map[node.id] = node;
  }

  return map;
}
const GET_PRODUCTS_BY_TAGS = `
  query getProductsByTags($query: String!, $cursor: String) {
    products(first: 250, after: $cursor, query: $query) {
      edges {
        node {
          id
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

async function fetchProductsByTags(admin, tags) {
  if (!tags || !tags.length) return [];

  const tagQuery = tags.map(tag => `tag:${tag}`).join(" OR ");

  let hasNextPage = true;
  let cursor = null;
  const productIds = [];

  while (hasNextPage) {
    const res = await admin.graphql(GET_PRODUCTS_BY_TAGS, {
      variables: {
        query: tagQuery,
        cursor,
      },
    });

    const json = await res.json();
    const products = json.data.products;

    products.edges.forEach(({ node }) => {
      productIds.push(node.id);
    });

    hasNextPage = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;
  }

  return productIds;
}


// console.log("session",sessionStorage);
export async function loader({ params, request }) {
    const { session, admin } = await authenticate.admin(request);
    const allTags = await fetchAllShopTags(admin);
  const purchase = await new Promise((resolve, reject) => {
    db.query(
      "SELECT * FROM purchase_table WHERE id = $1 ",
      [params.id],
      (err, res) => (err ? reject(err) : resolve(res.rows[0]))
    );
  });


  if (!purchase) {
    throw new Response("Not Found", { status: 404 });
  }
if (!purchase?.selling_plan_group_id) {
  console.log("⚠️ Missing selling_plan_group_id for:", purchase?.id);
}
  const productIds =
    purchase.products && purchase.products !== "null"
      ? purchase.products.split(",")
      : [];

  const variantIds =
    purchase.variants && purchase.variants !== "null"
      ? purchase.variants.split(",")
      : [];

  const tagList =
    purchase.tags && purchase.tags !== "null"
      ? purchase.tags.split(",")
      : [];

  const excludedIds =
    purchase.whole && purchase.whole !== "null"
      ? purchase.whole.split(",")
      : [];


  const allIds = [...productIds, ...variantIds, ...excludedIds];


  const nodesMap = await fetchTitlesByIds(admin, allIds);

  const excludedProducts = excludedIds.map((id) => {
    const p = nodesMap[id];
    return {
      id,
      title: p?.title ?? "Deleted product",
      image: p?.featuredImage?.url ?? null,
        status: p?.status || "UNKNOWN",
    };
  });

  const products = productIds.map((id) => {
    const p = nodesMap[id];
    return {
      id,
      title: p?.title ?? "Deleted product",
      image: p?.featuredImage?.url ?? null,
          status: p?.status, 
    };
  });


  const variants = variantIds.map((id) => {
    const v = nodesMap[id];
    return {
        id: v?.id || id,
       productId: v?.product?.id,  
      title: v?.title ?? "Deleted variant",
      productTitle: v?.product?.title ?? "",
      image:
        v?.image?.url ||
        v?.product?.featuredImage?.url ||
        null,
    };
  });



  return {
      shop: session.shop,
    purchase,
    products,
    variants,
    excludedProducts,
    allTags,
    tags: tagList,
    sellingPlanId: purchase.selling_plan_id,
  };
}


export async function action({ request, params }) {
    console.time("TOTAL_ACTION");
    
  console.time("AUTH");
  const { admin } = await authenticate.admin(request);
   console.timeEnd("AUTH")
  const formData = await request.formData();
  const intent = formData.get("_intent");
  const selectiontype = formData.get("selectiontype");

  const productIds =
    selectiontype === "Products" ? formData.getAll("products") : [];
  const variantIds =
    selectiontype === "Variants" ? formData.getAll("variants") : [];
  const tags =
    selectiontype === "Tags" ? formData.getAll("tags").join(",") || "null" : "null";
  const whole =
    selectiontype === "Whole store"
      ? formData.getAll("excludedProducts").join(",") || "null"
      : "null";
  const products = productIds.join(",") || "null";
  const variants = variantIds.join(",") || "null";
  const payInFull = Number(formData.get("payfull")); // ✅ WORKS

  console.log("payfull:", formData.get("payfull")); // "1" or "0"


  const getNumericId = (gid) => {
    if (!gid) return "";
    return gid.toString().split("/").pop();
  };

  
  if (intent === "delete") {


    const planRow = await new Promise((resolve, reject) => {
      db.query(
        `SELECT selling_plan_group_id
         FROM purchase_table
         WHERE id = $1`,
        [params.id],
        (err, res) => (err ? reject(err) : resolve(res.rows[0]))
      );
    });

    if (!planRow?.selling_plan_group_id) {
      throw new Error("Selling plan group id missing");
    }

    const { session } = await authenticate.admin(request);


    await deleteSellingPlanGroup({
      shop: session.shop,
      accessToken: session.accessToken,
      sellingPlanGroupId: planRow.selling_plan_group_id,
    });

 
    await new Promise((resolve, reject) => {
      db.query(
        "DELETE FROM purchase_table WHERE id = $1",
        [params.id],
        (err) => (err ? reject(err) : resolve())
      );
    });

    return redirect("/app");
  }
  console.time("DB_UPDATE");
  await new Promise((resolve, reject) => {
    db.query(
      `UPDATE purchase_table SET
        purchase_option_name=$1,
        line_item_text=$2,
        selection_type=$3,
        products=$4,
        variants=$5,
        tags=$6,
        whole=$7,
        deposit_options_display=$8,
        payment_collection_type=$9,
        deposit_type=$10,
        deposit_amount=$11,
        payin_full=$12,
        deferred_due=$13,
        remaining_balance_days=$14,
        remaining_balance_date=$15
       WHERE id=$16`,
      [
        formData.get("purchaseName"),
        formData.get("lineItemText"),
        selectiontype,
        products,
        variants,
        tags,
        whole,
        formData.get("depositDisplay"),
        formData.get("paymentCollection"),
        formData.get("depositType"),
        formData.get("depositAmount"),
      Number(formData.get("payfull")),
        formData.get("deferredDue"),
        formData.get("remainingDueday") || null,
        formData.get("remainingDuedate") || null,
        params.id,
      ],
      (err) => (err ? reject(err) : resolve())
    );
    
console.timeEnd("DB_UPDATE");
  });

  const planRow = await new Promise((resolve, reject) => {
    db.query(
      `SELECT selling_plan_group_id, selling_plan_id
       FROM purchase_table
       WHERE id = $1`,
      [params.id],
      (err, res) => (err ? reject(err) : resolve(res.rows[0]))
    );
  });
console.log("PARAM ID:", params.id);
  if (!planRow?.selling_plan_group_id) throw new Error("Missing selling plan group id");


  let remainingBalanceConfig = {};
  if (formData.get("deferredDue") === "days") {
    remainingBalanceConfig = {
      remainingBalanceChargeTrigger: "TIME_AFTER_CHECKOUT",
      remainingBalanceChargeTimeAfterCheckout: `P${formData.get("remainingDueday")}D`,
      remainingBalanceChargeExactTime: null,
    };
  } else if (formData.get("deferredDue") === "date") {
    remainingBalanceConfig = {
      remainingBalanceChargeTrigger: "EXACT_TIME",
      remainingBalanceChargeExactTime: `${formData.get("remainingDuedate")}T00:00:00Z`,
      remainingBalanceChargeTimeAfterCheckout: null,
    };
  }

  const checkoutCharge =
    formData.get("depositType") === "percentage"
      ? { type: "PERCENTAGE", value: { percentage: Number(formData.get("depositAmount")) } }
      : { type: "PRICE", value: { fixedValue: Number(formData.get("depositAmount")) } };
console.time("PLAN_UPDATE");
console.timeEnd("PLAN_UPDATE");

  await admin.graphql(
    `
    mutation sellingPlanGroupUpdate($id: ID!, $input: SellingPlanGroupInput!) {
      sellingPlanGroupUpdate(id: $id, input: $input) {
        sellingPlanGroup { id }
        userErrors { field message }
      }
    }
  `,
    {
      variables: {
        id: planRow.selling_plan_group_id,
        input: {
          ...(formData.get("lineItemText") && { name: formData.get("lineItemText") }),
          ...(planRow.selling_plan_id && {
            sellingPlansToUpdate: [
              {
                id: planRow.selling_plan_id,
                name: formData.get("lineItemText"),
                billingPolicy: { fixed: { checkoutCharge, ...remainingBalanceConfig } },
              },
            ],
          }),
        },
      }
    }
  );

  const existingRes = await admin.graphql(
    `
    query getPlanProducts($id: ID!) {
      sellingPlanGroup(id: $id) {
        products(first: 50) { nodes { id } }
        productVariants(first: 50) { nodes { id } }
      }
    }
  `,
    { variables: { id: planRow.selling_plan_group_id } }
  );

  const existingData = await existingRes.json();
  // const existingProductIds = existingData.data.sellingPlanGroup.products.nodes.map(p => p.id);
  const existingProductIds =
  await getAllExistingPlanProducts(admin, planRow.selling_plan_group_id);

  const existingVariantIds = existingData.data.sellingPlanGroup.productVariants.nodes.map(v => v.id);


  // ================= WHOLE STORE LOGIC (ACTION ONLY) =================
  // if (selectiontype === "Whole store") {
  //   const allProductIds = await getAllProductIds({ admin });

  //   const excludedProductIds = formData.getAll("excludedProducts");

  //   const finalProductIds = allProductIds.filter(
  //     id => !excludedProductIds.includes(id)
  //   );

  //   const productsToAdd = finalProductIds.filter(
  //     id => !existingProductIds.includes(id)
  //   );

  //   const productsToRemove = existingProductIds.filter(
  //     id => excludedProductIds.includes(id)
  //   );

  //   if (productsToAdd.length) {
  //     await admin.graphql(
  //       `
  //     mutation addProducts($id: ID!, $productIds: [ID!]!) {
  //       sellingPlanGroupAddProducts(id: $id, productIds: $productIds) {
  //         userErrors { field message }
  //       }
  //     }
  //     `,
  //       {
  //         variables: {
  //           id: planRow.selling_plan_group_id,
  //           productIds: productsToAdd,
  //         },
  //       }
  //     );
  //   }

  //   if (productsToRemove.length) {
  //     await admin.graphql(
  //       `
  //     mutation removeProducts($id: ID!, $productIds: [ID!]!) {
  //       sellingPlanGroupRemoveProducts(id: $id, productIds: $productIds) {
  //         userErrors { field message }
  //       }
  //     }
  //     `,
  //       {
  //         variables: {
  //           id: planRow.selling_plan_group_id,
  //           productIds: productsToRemove,
  //         },
  //       }
  //     );
  //   }
  // }

if (selectiontype === "Whole store") {
  const allProductIds = await getAllProductIds({ admin });
  const excludedProductIds = formData.getAll("excludedProducts");

  // Final desired state
  const finalProductIds = allProductIds.filter(
    id => !excludedProductIds.includes(id)
  );

  const productsToAdd = finalProductIds.filter(
    id => !existingProductIds.includes(id)
  );

  const productsToRemove = existingProductIds.filter(
    id => excludedProductIds.includes(id)
  );
// important only change for speed
//   // ➖ Remove excluded
//   for (let i = 0; i < productsToRemove.length; i += 250) {
//     await admin.graphql(
//       `
//       mutation removeProducts($id: ID!, $productIds: [ID!]!) {
//         sellingPlanGroupRemoveProducts(id: $id, productIds: $productIds) {
//           userErrors { field message }
//         }
//       }
//       `,
//       {
//         variables: {
//           id: planRow.selling_plan_group_id,
//           productIds: productsToRemove.slice(i, i + 250),
//         },
//       }
//     );
//   }

//   // ➕ Add missing
//   for (let i = 0; i < productsToAdd.length; i += 250) {
//     await admin.graphql(
//       `
//       mutation addProducts($id: ID!, $productIds: [ID!]!) {
//         sellingPlanGroupAddProducts(id: $id, productIds: $productIds) {
//           userErrors { field message }
//         }
//       }
//       `,
//       {
//         variables: {
//           id: planRow.selling_plan_group_id,
//           productIds: productsToAdd.slice(i, i + 250),
//         },
//       }
//     );
//   }
// }

const removePromises = [];
for (let i = 0; i < productsToRemove.length; i += 250) {
  removePromises.push(
    admin.graphql(`
      mutation removeProducts($id: ID!, $productIds: [ID!]!) {
        sellingPlanGroupRemoveProducts(id: $id, productIds: $productIds) {
          userErrors { field message }
        }
      }
    `, {
      variables: {
        id: planRow.selling_plan_group_id,
        productIds: productsToRemove.slice(i, i + 250),
      },
    })
  );
}

await Promise.all(removePromises);

const addPromises = [];
for (let i = 0; i < productsToAdd.length; i += 250) {
  addPromises.push(
    admin.graphql(`
      mutation addProducts($id: ID!, $productIds: [ID!]!) {
        sellingPlanGroupAddProducts(id: $id, productIds: $productIds) {
          userErrors { field message }
        }
      }
    `, {
      variables: {
        id: planRow.selling_plan_group_id,
        productIds: productsToAdd.slice(i, i + 250),
      },
    })
  );
}

await Promise.all(addPromises);

}


  const newProductIds = productIds.filter(id => !existingProductIds.includes(id));
  const newVariantIds = variantIds.filter(id => !existingVariantIds.includes(id));

  if (newProductIds.length) {
    await admin.graphql(
      `
      mutation addProducts($id: ID!, $productIds: [ID!]!) {
        sellingPlanGroupAddProducts(id: $id, productIds: $productIds) {
          userErrors { field message }
        }
      }
    `,
      { variables: { id: planRow.selling_plan_group_id, productIds: newProductIds } }
    );
  }

  if (newVariantIds.length) {
    await admin.graphql(
      `
      mutation addVariants($id: ID!, $variantIds: [ID!]!) {
        sellingPlanGroupAddProductVariants(id: $id, productVariantIds: $variantIds) {
          userErrors { field message }
        }
      }
    `,
      { variables: { id: planRow.selling_plan_group_id, variantIds: newVariantIds } }
    );
  }

  // update tag  and product along with tags
  if (selectiontype === "Tags") {
    const selectedTags = formData.getAll("tags");

    const tagProductIds = await fetchProductsByTags(admin, selectedTags);


    const productsToAdd = tagProductIds.filter(
      id => !existingProductIds.includes(id)
    );

    const productsToRemove = existingProductIds.filter(
      id => !tagProductIds.includes(id)
    );

    if (productsToAdd.length) {
      await admin.graphql(
        `
      mutation addProducts($id: ID!, $productIds: [ID!]!) {
        sellingPlanGroupAddProducts(id: $id, productIds: $productIds) {
          userErrors { field message }
        }
      }
      `,
        {
          variables: {
            id: planRow.selling_plan_group_id,
            productIds: productsToAdd,
          },
        }
      );
    }

    if (productsToRemove.length) {
      await admin.graphql(
        `
      mutation removeProducts($id: ID!, $productIds: [ID!]!) {
        sellingPlanGroupRemoveProducts(id: $id, productIds: $productIds) {
          userErrors { field message }
        }
      }
      `,
        {
          variables: {
            id: planRow.selling_plan_group_id,
            productIds: productsToRemove,
          },
        }
      );
    }
  }


  return redirect("/app?toast=purchase-updated");
}


export default function EditPurchasePage(
) {
   const {
    shop,
    purchase,
    products,
    variants,
    excludedProducts: excludedProductsFromDB,
    tags: tagsFromDB,
    allTags,
    sellingPlanId,
  } = useLoaderData();
 const originalDueType = purchase.deferred_due; // "days" | "date"
  const fetcher = useFetcher();
  const app = useAppBridge();
  const [purchaseName, setPurchaseName] = useState("");
  const [text, setText] = useState("");
  const [selectedType, setSelectedType] = useState("Products");
  const [depositType, setDepositType] = useState("percentage");
  const [depositAmount, setDepositAmount] = useState("");
  const [allowFullPayment, setAllowFullPayment] = useState(true);
  const [selected, setSelected] = useState("always");
  const [paymentCollection, setPaymentCollection] = useState("Manual");
  const [dueDateType, setDueDateType] = useState("days");
  const [days, setDays] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date());

  const [popoverActive, setPopoverActive] = useState(false);
const [deleteModalActive, setDeleteModalActive] = useState(false);

const toggleDeleteModal = useCallback(
  () => setDeleteModalActive((active) => !active),
  []
);
const navigation = useNavigation();

const isSubmitting =
  navigation.state === "submitting" 



  // const ALL_TAGS = [
  //   "Accessory",
  //   "Archived",
  //   "Premium",
  //   "Snow",
  //   "Snowboard",
  //   "Sport",
  //   "Winter",
  //   "Bicycle",
  //   "Black"
  // ];
  const togglePopover = useCallback(
    () => setPopoverActive((active) => !active),
    []
  );

  const [{ month, year }, setViewDate] = useState({
    month: selectedDate.getMonth(),
    year: selectedDate.getFullYear(),
  });

  const handleMonthChange = useCallback(
    (month, year) => setViewDate({ month, year }),
    []
  );

  const [selectedProducts, setSelectedProducts] = useState([]);
  const [selectedVariants, setSelectedVariants] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [excludedProducts, setExcludedProducts] = useState([]);

  const [tagInput, setTagInput] = useState("");

  const [errors, setErrors] = useState({});


  const URL =
    `https://${shop}/admin/products/`;

  const getNumericId = (gid) => {
    if (!gid) return null;
    if (typeof gid === "number") return gid;
    if (typeof gid === "string") return gid.includes("/") ? gid.split("/").pop() : gid;
    return null;
  };

  const handleViewProduct = (productId) => {
    const numericId = getNumericId(productId);
    if (!numericId) return;
    const productUrl = `${URL}${numericId}`;
    window.open(productUrl, "_blank");
  };

const handleViewVariant = (variantId, productId) => {
  const variantNumeric = getNumericId(variantId);
  const productNumeric = getNumericId(productId);

  if (!variantNumeric || !productNumeric) return;

  const url = `${URL}${productNumeric}?variant=${variantNumeric}`;

  window.open(url, "_blank");
};
  // const handleOpenPicker = async () => {
  //     try {
  //         const result = await shopify.resourcePicker({
  //             type: "product",
  //             multiple: true,
  //             filter: { variants: false },
  //             initialSelectionIds: selectedProducts.map(p => ({ id: p.id })),
  //         });

  //         if (result?.selection) {
  //             // Merge previous selection with new selection
  //             const merged = [
  //                 ...selectedProducts,
  //                 ...result.selection.filter(
  //                     (newItem) => !selectedProducts.some((p) => p.id === newItem.id)
  //                 ),
  //             ];
  //             setSelectedProducts(merged);
  //         }
  //     } catch (error) {
  //         console.error("Error opening product picker:", error);
  //     }
  // };

  const handleOpenPicker = async () => {
    try {
      const result = await shopify.resourcePicker({
        type: "product",
        multiple: true,
        filter: { variants: false },
        initialSelectionIds: selectedProducts.map(p => ({ id: p.id })),
      });

      if (result?.selection) {
        const normalized = result.selection.map((p) => ({
          id: p.id,
          title: p.title,
          image:
            p.featuredImage?.url ||
            p.images?.[0]?.originalSrc ||
            p.image?.originalSrc ||
            null,
             status: p.status || "UNKNOWN",
        }));

        setSelectedProducts((prev) => {
          const merged = [...prev];
          normalized.forEach((p) => {
            if (!merged.some((m) => m.id === p.id)) {
              merged.push(p);
            }
          });
          return merged;
        });
      }
    } catch (error) {
      console.error("Error opening product picker:", error);
    }
  };

  //    const handleExcludeProductPicker = async () => {
  //     try {
  //         const result = await shopify.resourcePicker({
  //             type: "product",
  //             multiple: true,
  //             filter: { variants: false },
  //             initialSelectionIds: excludedProducts.map(p => ({ id: p.id })),
  //         });

  //         if (result?.selection) {
  //             setExcludedProducts((prev) => {
  //                 const merged = [
  //                     ...prev,
  //                     ...result.selection.filter(
  //                         (newItem) => !prev.some((p) => p.id === newItem.id)
  //                     ),
  //                 ];
  //                 return merged;
  //             });
  //         }
  //     } catch (error) {
  //         console.error("Error opening exclude picker:", error);
  //     }
  // };

  const handleExcludeProductPicker = async () => {
    try {
      const result = await shopify.resourcePicker({
        type: "product",
        multiple: true,
        filter: { variants: false },
        initialSelectionIds: excludedProducts.map(p => ({ id: p.id })),
      });

      if (result?.selection) {
        const normalized = result.selection.map((p) => ({
          id: p.id,
          title: p.title,
          image:
            p.featuredImage?.url ||
            p.images?.[0]?.originalSrc ||
            p.image?.originalSrc ||
            null,
             status: p.status || "UNKNOWN",
        }));

        setExcludedProducts((prev) => {
          const merged = [...prev];
          normalized.forEach((p) => {
            if (!merged.some((m) => m.id === p.id)) {
              merged.push(p);
            }
          });
          return merged;
        });
      }
    } catch (error) {
      console.error("Error opening exclude picker:", error);
    }
  };


  const handleOpenPickervariant = async () => {
    try {
      const selected = await shopify.resourcePicker({
        type: "product",
        multiple: true,
        filter: { variants: true },
      });

      if (selected) {
        const variants = selected.selection.flatMap((product) =>
          product.variants.map((variant) => ({
            id: variant.id,
            title: variant.title,
            image:
              variant.image?.url ||
              product.featuredImage?.url ||
              product.images?.[0]?.originalSrc ||
              null,

            productId: product.id,
            productTitle: product.title,
            productImage:
              product.featuredImage?.url ||
              product.images?.[0]?.originalSrc ||
              null,
             productStatus: product.status,
          }))
        );
        console.log("jhdfh", variants);
        setSelectedVariants(prev => {
          const merged = [...prev];
          variants.forEach(v => {
            if (!merged.some(p => p.id === v.id)) {
              merged.push(v);
            }
          });
          return merged;
        });

        // const productIds = [...new Set(selected.selection.map((p) => p.id))];
        // setSelectedProductIds(productIds);
      }

    } catch (error) {
      console.error("Error opening variant picker:", error);
    }
  };


  const handleTagSelect = useCallback(
    (tag) => {
      setSelectedTags((prev) => {
        // Add only if it doesn't exist yet
        if (prev.some(t => t === tag)) return prev;
        return [...prev, tag];
      });
      setTagInput("");
    },
    []
  );


  const handleRemoveTag = useCallback(
    (tag) => () => {
      setSelectedTags((prev) => prev.filter((t) => t !== tag));
    },
    []
  );
const filteredTags = useMemo(() => {
  return allTags.filter(
    (tag) =>
      tag.toLowerCase().includes(tagInput.toLowerCase()) &&
      !selectedTags.includes(tag)
  );
}, [allTags, tagInput, selectedTags]);

  // const filteredTags = useMemo(() => {
  //   return ALL_TAGS.filter(
  //     (tag) =>
  //       tag.toLowerCase().includes(tagInput.toLowerCase()) &&
  //       !selectedTags.includes(tag)
  //   );
  // }, [tagInput, selectedTags]);

  useEffect(() => {
    if (!purchase) return;

    setPurchaseName(purchase.purchase_option_name || "");
    setText(purchase.line_item_text || "");
    setSelectedType(purchase.selection_type || "Products");

    setDepositType(purchase.deposit_type || "percentage"); // percentage or exact
    setDepositAmount(purchase.deposit_amount || "");

    setAllowFullPayment(purchase.payin_full === 1);

    setSelectedProducts(products || []);
    setSelectedVariants(variants || []);
    setExcludedProducts(excludedProductsFromDB || []);
    setSelectedTags(tagsFromDB || []);
  setDueDateType(purchase.deferred_due || "days");

    setDays(purchase.remaining_balance_days || "");
    setSelectedDate(purchase.remaining_balance_date ? new Date(purchase.remaining_balance_date) : new Date());
  }, [purchase, products, variants, excludedProductsFromDB, tagsFromDB]);



const formatDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

  const getStatusBadgeProps = (status) => {
    switch (status) {
      case "ACTIVE":
        return { tone: "success", label: "Active" };
      case "ARCHIVED":
        return { tone: "warning", label: "Archived" };
      case "DRAFT":
        return { tone: "critical", label: "Draft" };
      default:
        return { tone: "info", label: status || "Unknown" };
    }
  };


  const renderContent = () => {
    if (errors.selection) {
      return <Text tone="critical">{errors.selection}</Text>;
    }

    // if (selectedType === "Products") {
    //   return (
    //     <BlockStack gap="300">
    //       {selectedProducts.map((product, index) => (
            
    //         <BlockStack key={product.id} gap="200">
    //           <InlineStack align="space-between">
    //             <InlineStack gap="200" align="center">
    //               <Thumbnail
    //                 source={product.image || ""}
    //                 alt={product.title}
    //                 size="small"
    //               />
    //               <Text as="span">{product.title || product.id}</Text>
                  
    // <Badge {...getStatusBadgeProps(product.status)} />
    //             </InlineStack>

    //             <InlineStack gap="200">
    //               <Button size="micro" onClick={() => handleViewProduct(product.id)}>
    //                 View
    //               </Button>

    //             </InlineStack>
    //           </InlineStack>

    //           {index < selectedProducts.length - 1 && <Divider />}
    //         </BlockStack>
    //       ))}

    //       <Box style={{ marginTop: "var(--p-space-400)" }}>

    //         <Button onClick={handleOpenPicker}>
    //           Modify Products
    //         </Button></Box>
    //     </BlockStack>
    //   );
    // }
if (selectedType === "Products") {
  return (
    <BlockStack gap="300">
      {selectedProducts.map((product, index) => {
        const badgeProps = getStatusBadgeProps(product.status);

        return (
          <BlockStack key={product.id} gap="200">
            <InlineStack align="space-between">
              <InlineStack gap="200" align="center">
                <Thumbnail
                  source={product.image || ""}
                  alt={product.title}
                  size="small"
                />

                <InlineStack gap="200" align="center">
                  <Text as="span">{product.title || product.id}</Text>

              <Badge tone={badgeProps.tone}>
  {badgeProps.label}
</Badge>


                </InlineStack>
              </InlineStack>

              <Button
                size="micro"
                onClick={() => handleViewProduct(product.id)}
              >
                View
              </Button>
            </InlineStack>

            {index < selectedProducts.length - 1 && <Divider />}
          </BlockStack>
        );
      })}

      <Box style={{ marginTop: "var(--p-space-400)" }}>
        <Button onClick={handleOpenPicker}>
          Modify Products
        </Button>
      </Box>
    </BlockStack>
  );
}


    if (selectedType === "Variants") {

      const groupedVariants = selectedVariants.reduce((acc, v) => {
        if (!acc[v.productTitle]) acc[v.productTitle] = [];
        acc[v.productTitle].push(v);
        return acc;
      }, {});
console.log("Variant object:", variants[0]);
      return (
        <BlockStack gap="300">
          {Object.entries(groupedVariants).map(
            
            ([productTitle, variants], index, arr) => (
              
              <BlockStack key={productTitle} gap="200">
                <InlineStack align="space-between">
                  <InlineStack gap="200" align="center">
                    <Thumbnail
                      source={variants[0].productImage || variants[0].image || ""}
                      alt={productTitle}
                      size="small"
                    />
                    <Text>
                      {productTitle} — {variants.map(v => v.title).join(", ")}
                      
                    </Text>
                  </InlineStack>

                  <InlineStack gap="200">
<Button
  size="micro"
  onClick={() =>
    handleViewVariant(variants[0].id, variants[0].productId)
  }
>
  View
</Button>
                  </InlineStack>
                </InlineStack>

                {index < arr.length - 1 && <Divider />}
              </BlockStack>
            )
          )}

          <Box style={{ marginTop: "var(--p-space-400)" }}>
            <Button onClick={handleOpenPickervariant}>Modify Variants</Button>
          </Box>
        </BlockStack>
      );
    }



    if (selectedType === "Tags") {
      return (
        <BlockStack gap="300">
          <InlineStack gap="200">
            {selectedTags.map((tag) => (
              <Tag key={tag} onRemove={handleRemoveTag(tag)}>
                {tag}
              </Tag>
            ))}
          </InlineStack>

          <Combobox
            activator={
              <Combobox.TextField
                label="Add tag"
                value={tagInput}
                onChange={setTagInput}
                autoComplete="off"
              />
            }
          >
            <Listbox onSelect={handleTagSelect}>
              {filteredTags.map((tag) => (
                <Listbox.Option key={tag} value={tag}>
                  {tag}
                </Listbox.Option>
              ))}
            </Listbox>
          </Combobox>
        </BlockStack>
      );
    }

    // if (selectedType === "Whole store") {
    //   return (
    //     <BlockStack gap="300">
    //       {excludedProducts.map((product, index) => (
            
    //         <BlockStack key={product.id} gap="200">
    //           <InlineStack align="space-between">
    //             <InlineStack gap="200" align="center">
    //               <Thumbnail
    //                 source={product.image || ""}
    //                 alt={product.title}
    //                 size="small"
    //               />
    //               <Text>{product.title || product.id}</Text>
    //             </InlineStack>

    //             <InlineStack gap="200">
    //               <Button size="micro" onClick={() => handleViewProduct(product.id)}>
    //                 View
    //               </Button>

    //             </InlineStack>
    //           </InlineStack>

    //           {index < excludedProducts.length - 1 && <Divider />}
    //         </BlockStack>
    //       ))}

    //       <Box style={{ marginTop: "var(--p-space-400)" }}>

    //         <Button onClick={handleExcludeProductPicker}>
    //           Exclude Products
    //         </Button></Box>
    //     </BlockStack>
    //   );
    // }
if (selectedType === "Whole store") {
  return (
    <BlockStack gap="300">
      {excludedProducts.map((product, index) => {
        const badgeProps = getStatusBadgeProps(product.status);

        return (
          <BlockStack key={product.id} gap="200">
            <InlineStack align="space-between">
              <InlineStack gap="200" align="center">
                <Thumbnail
                  source={product.image || ""}
                  alt={product.title}
                  size="small"
                />

                <InlineStack gap="100" align="center">
                  <Text>{product.title || product.id}</Text>

                  <Badge tone={badgeProps.tone}>
                    {badgeProps.label}
                  </Badge>
                </InlineStack>
              </InlineStack>

              <InlineStack gap="200">
                <Button
                  size="micro"
                  onClick={() => handleViewProduct(product.id)}
                >
                  View
                </Button>
              </InlineStack>
            </InlineStack>

            {index < excludedProducts.length - 1 && <Divider />}
          </BlockStack>
        );
      })}

      <Box style={{ marginTop: "var(--p-space-400)" }}>
        <Button onClick={handleExcludeProductPicker}>
          Exclude Products
        </Button>
      </Box>
    </BlockStack>
  );
}

    return null;
  };

  const isDisabledType = (type) =>
    selectedType && selectedType !== type;

  const validateForm = () => {
    const e = {};
    if (!purchaseName.trim()) e.purchaseName = "Purchase option name required";
    if (!depositAmount || Number(depositAmount) <= 0)
      e.depositAmount = "Deposit amount must be greater than 0";
    if (selectedType === "Products" && !selectedProducts.length)
      e.selection = "Select at least one product";
    if (selectedType === "Variants" && !selectedVariants.length)
      e.selection = "Select at least one variant";
    if (selectedType === "Tags" && !selectedTags.length)
      e.selection = "Add at least one tag";
    setErrors(e);
    return !Object.keys(e).length;
  };

  return (
    <>
<div
  style={{
    filter: isSubmitting ? "blur(4px)" : "none",
    pointerEvents: isSubmitting ? "none" : "auto",
    transition: "0.02s ease"
  }}
>
      <Box style={{ margin: "25px", "--p-space-050": "20px", textDecoration: 'none' }}>

        <Text ><Link url="/app" removeUnderline tone="base" >Dashboard </Link>/ Purchase option</Text>
      </Box>
      <Page>
        <TitleBar title="Edit Purchase Option" />

        <fetcher.Form
          data-save-bar
          method="post"
          onSubmit={(e) => {
            if (!validateForm()) e.preventDefault();
          }}
        >
          <Layout>
            <Layout.Section>
              <BlockStack>
                <Text as="h2" variant="headingLg">Purchase Option</Text>
                <Box style={{ marginTop: '20px' }}>

                  <Text>Purchase Option ID: {getNumericId(sellingPlanId)}</Text>
                </Box>
              </BlockStack>
              {Object.keys(errors).length > 0 && (
                <Layout.Section>
                  <Banner
                    tone="critical"
                    title="Please fix the following errors"
                  >
                    <ul>
                      {Object.values(errors).map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </Banner>
                </Layout.Section>
              )}

            </Layout.Section>
            {/* Purchase option name */}
            <Layout.Section>
              <Box >
                <Card >
                  <Text as="h2" variant="headingSm">
                    Purchase option name
                  </Text>
                  <Box paddingBlockStart="400">
                    <TextField
                      placeholder="Name"
                      value={purchaseName}
                      name="purchaseName"
                      required={true}
                      onChange={setPurchaseName}
                      type="text"
                      helpText={
                        <span>
                          Added as an order tag to all orders made using this purchase option
                        </span>
                      }

                    />
                  </Box>
                </Card>
              </Box>
            </Layout.Section>
            {/* Line item help text */}
            <Layout.Section>
              <Box style={{ marginTop: "var(--p-space-600)" }}>

                <Card>
                  <Box >
                    <Text as="h2" variant="headingSm">
                      Line item help text
                    </Text>
                    <Box paddingBlockStart="400">
                      <TextField
                        value={text}
                        type="text"

                        name="lineItemText"
                        maxLength={29}
                        showCharacterCount
                        onChange={setText}
                        helpText={
                          <span>
                            Identifies line items using this purchase option in customer carts and checkouts
                          </span>
                        }
                      />
                    </Box>
                  </Box>
                </Card>
              </Box>
            </Layout.Section>
            {/* production selection */}
            <Layout.Section>
              <Box style={{ marginTop: "var(--p-space-600)" }}>
                <Card>
                  <Box>
                    <Text as="h2" variant="headingSm">
                      Product selection type
                    </Text>
                    <Box style={{ marginTop: "var(--p-space-400)" }}>

                      <InlineStack gap="150">
                        {["Products", "Variants", "Tags", "Whole store"].map((type) => (
                          <Box
                            key={type}
                            style={{
                              opacity: isDisabledType(type) ? 0.95 : 1,
                              filter: isDisabledType(type) ? "grayscale(100%)" : "none",
                              pointerEvents: isDisabledType(type) ? "none" : "auto",
                              transition: "opacity 0.2s ease",
                            }}
                          >
                            {isDisabledType(type) && (
                              <Box
                                style={{
                                  position: "absolute",
                                  inset: 0,
                                  background: "rgba(70, 2, 2, 0.08)", // 🔥 darkness level
                                  borderRadius: "var(--p-border-radius-400)",
                                  zIndex: 1,
                                }}
                              />
                            )}

                            <Button
                              type="button"
                              variant={selectedType === type ? "primary" : undefined}
                              disabled={isDisabledType(type)}
                            >
                              {type}
                            </Button>
                          </Box>
                        ))}
                      </InlineStack>


                    </Box>
                    <input type="hidden" name="selectiontype" value={selectedType} />

                    {selectedType === "Products" &&
                      selectedProducts.map((p) => (
                        <input key={p.id} type="hidden" name="products" value={p.id} />
                      ))}

                    {selectedType === "Variants" &&
                      selectedVariants.map((v) => (
                        <input key={v.id} type="hidden" name="variants" value={v.id} />
                      ))}

                    {selectedType === "Tags" &&
                      selectedTags.map((t) => (
                        <input key={t} type="hidden" name="tags" value={t} />
                      ))}
                    {selectedType === "Whole store" &&
                      excludedProducts.map((p) => (
                        <input key={p.id} type="hidden" name="excludedProducts" value={p.id} />
                      ))}

                    <Box padding="400">{renderContent()}</Box>

                  </Box>

                </Card>
              </Box>
            </Layout.Section>
            {/* Deposit options */}
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd">Deposit options</Text>

                  <Text>Choose the deposit type and amount to charge per product at checkout</Text>

                  <BlockStack gap="300">
                    <RadioButton
                      label="Percentage of the total product price"
                      checked={depositType === "percentage"}
                      id="percentage"
                      value="percentage"
                      name="depositType"
                      onChange={() => setDepositType("percentage")}
                    />

                    <RadioButton
                      label="Exact amount"
                      checked={depositType === "exact"}
                      id="exact"
                      value="exact"
                      name="depositType"
                      onChange={() => setDepositType("exact")}
                    />
                  </BlockStack>


                  <TextField
                    prefix={depositType === "percentage" ? "%" : "$"}
                    label="Deposit amount"
                    type="number"
                    min={0}
                    max={depositType === "percentage" ? 100 : undefined}
                    value={depositAmount}
                    name="depositAmount"
                    onChange={(val) => setDepositAmount(val)}
                    helpText={
                      depositType === "percentage"
                        ? "A number between 0 and 100"
                        : "Enter a fixed amount"
                    }
                  />

                  <Checkbox
                    label="Give customers the option to pay in full"
                    checked={allowFullPayment}
                 
                    onChange={(checked) => setAllowFullPayment(checked)}
                    helpText="Checked means customers can either leave a deposit or pay in full up front"
                  />
<input
  type="hidden"
  name="payfull"
  value={allowFullPayment ? "1" : "0"}
/>
                </BlockStack>
              </Card>
            </Layout.Section>
            {/* deposite option display */}
            <Layout.Section>
              <Card>
                <BlockStack gap="300">

                  <Text as="h2" variant="headingSm">
                    Deposite option display
                  </Text>

                  {selected === "outOfStock" && (
                    <Banner tone="info">

                      <Text>

                        When using the out of stock display option, variants must be set to continue selling when out of stock
                      </Text>
                    </Banner>
                  )}

                  <Text>
                    Choose when to display the deposit purchase option for variants
                  </Text>

                  <RadioButton
                    label="Always"
                    id="always"
                    value="always"
                    name="depositDisplay"
                    checked={selected === "always"}
                    onChange={() => setSelected("always")}
                  />

                  <RadioButton
                    label="When variant is out of stock"
                    id="outOfStock"
                    value="outOfStock"
                    name="depositDisplay"
                    checked={selected === "outOfStock"}
                    onChange={() => setSelected("outOfStock")}
                  />

                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Payment collection type */}
            <Layout.Section>
              <Box>
                <Card>
                  <Text as="h2" variant="headingSm">
                    Payment collection type
                  </Text>
                  <RadioButton
                    label="Manual"
                    name="paymentCollection"
                    value="Manual"
                    checked={paymentCollection === "Manual"}
                    onChange={() => setPaymentCollection("Manual")}

                    helpText={
                      <span>
                        Collect payment from the card on file using the button on the Shopify {" "}
                        <Link url="https://your-link.com" target="_blank">
                          order details
                        </Link>{" "}page
                      </span>
                    }
                  />


                  <Text>Enable automatic payment collection with Downpay's collect payment action    <Link as="span">
                    <span style={{ fontWeight: 700, textDecoration: 'none' }}>in shopify flow</span>
                  </Link></Text>
                </Card>
              </Box>
            </Layout.Section>

            {/* Deferred payment due date */}
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingSm">
                    Deferred payment due date
                  </Text>

                  <Text as="p" variant="bodySm">
                    Shown to customers on your online store and visible on order details
                    pages in the Shopify admin. You can also use due dates to set up
                    customer <Link url="#">payment reminders</Link>.
                  </Text>

                  <Banner tone="info">
                    <Text as="p" variant="bodySm">
                      If payment due dates are unknown and you want to collect balances on
                      fulfilment, fill in a number of days but change what displays in{" "}
                      <Link url="#">your theme</Link>.
                    </Text>
                  </Banner>

                  <BlockStack gap="300">
                    <Text as="h3" variant="headingXs">
                      Choose a due date type
                    </Text>

                    <RadioButton
                      label="Number of days after checkout"
                      helpText="Useful for made-to-order products or if availability is unknown"
                      checked={dueDateType === "days"}
                      value="days"
                      name="deferredDue"
                        disabled={originalDueType === "date"}
                      onChange={() => setDueDateType("days")}
                    />

                    <RadioButton
                      label="On a specific date"
                      helpText="Useful for pre-orders and bookings"
                      checked={dueDateType === "date"}
                      value="date"
                      name="deferredDue"
                       disabled={originalDueType === "days"}  
                      onChange={() => setDueDateType("date")}
                    />
                  </BlockStack>


                {dueDateType === "days" && originalDueType === "days" && (
  <TextField
    label="Remaining balance due"
    type="number"
    value={days}
    name="remainingDueday"
    onChange={setDays}
    suffix="days after checkout"
    autoComplete="off"
  />
)}



       {/* {dueDateType === "date" && originalDueType === "date" && (
  <>
    <Popover
      active={popoverActive}
      onClose={() => setPopoverActive(false)}
      activator={
        <TextField
          label="Remaining balance due"
          type="text"
          readOnly
          value={selectedDate.toISOString().split("T")[0]}
          onFocus={() => setPopoverActive(true)}
        />
      }
    >
      <Popover.Pane fixed>
        <DatePicker
          month={month}
          year={year}
          selected={selectedDate}
          onMonthChange={handleMonthChange}
          disableDatesBefore={new Date()}
          onChange={({ start }) => {
            setSelectedDate(start);
            setPopoverActive(false);
          }}
        />
      </Popover.Pane>
    </Popover>

    <input
      type="hidden"
      name="remainingDuedate"
      value={selectedDate.toISOString().split("T")[0]}
    />
  </>
)} */}
{dueDateType === "date" && originalDueType === "date" && (
  <>
    <Popover
      active={popoverActive}
      onClose={() => setPopoverActive(false)}
      activator={
        <TextField
          label="Remaining balance due"
          type="text"
          readOnly
          value={formatDate(selectedDate)}
          onFocus={() => setPopoverActive(true)}
        />
      }
    >
      <Popover.Pane fixed>
        <DatePicker
          month={month}
          year={year}
          selected={selectedDate}
          disableDatesBefore={new Date()}
          onMonthChange={handleMonthChange}
          onChange={({ start }) => {
            setSelectedDate(start);
            setPopoverActive(false);
          }}
        />
      </Popover.Pane>
    </Popover>

    <input
      type="hidden"
      name="remainingDuedate"
      value={formatDate(selectedDate)}
    />
  </>
)}



                </BlockStack>
              </Card>
            </Layout.Section>

          </Layout>
          <Layout.Section>
            <InlineStack align="space-between">
              {/* <Button submit primary>
                   Update Purchase Option
               </Button> */}

           <Button tone="critical" onClick={toggleDeleteModal}>
  Delete
</Button>

            </InlineStack>
          </Layout.Section>


        </fetcher.Form>
<Modal
  open={deleteModalActive}
  onClose={toggleDeleteModal}
  title="Delete purchase option?"
  primaryAction={{
    content: "Delete",
    destructive: true,
    onAction: () => {
      const fd = new FormData();
      fd.set("_intent", "delete");
      fetcher.submit(fd, { method: "post" });
      toggleDeleteModal();
    },
  }}
  secondaryActions={[
    {
      content: "Cancel",
      onAction: toggleDeleteModal,
    },
  ]}
>
  <Modal.Section>
    <Text>This can't be undone.</Text>
  </Modal.Section>
</Modal>

        <Outlet />
      </Page>
      </div>
    </>
  );

}

