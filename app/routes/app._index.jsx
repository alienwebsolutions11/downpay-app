import { useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  ButtonGroup,
  Link,
  InlineStack,
  Icon,
  Badge,
  Image,
  ResourceList,
  ResourceItem,
  Pagination,
  Thumbnail,
  Popover,
  ActionList,
  Modal,

} from "@shopify/polaris";

import { useSearchParams } from "@remix-run/react";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { redirect, json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { useState } from "react";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { deleteSellingPlanGroup,isThemeBlockActive } from "../Utils/shopifyHelpers.server";
import { getTotalProductCount } from "../Utils/shopifyHelpers.server"
import logo from '../routes/Photos/down.jpg'
import alien from '../routes/Photos/alien.jpg'
import {
  QuestionCircleIcon, MagicIcon, NoteIcon, CalendarIcon
} from '@shopify/polaris-icons';
import { useRevalidator } from "@remix-run/react";

import db from "../Utils/db.createserver"
// import { Section } from "@shopify/polaris/build/ts/src/components/Listbox";



export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // const purchases = await new Promise((resolve, reject) => {
  //   db.query(
  //     `SELECT *
  //      FROM purchase_table
  //      ORDER BY purchase_id DESC`,
  //     (err, results) => (err ? reject(err) : resolve(results))
  //   );
  // });
// const themeExtensionActive = await new Promise((resolve, reject) => {
//   db.query(
//     `
//     SELECT theme_block_active
//     FROM purchase_table
//     WHERE shop = ?
//     `,
//     [session.shop],
//     (err, res) =>
//       err ? reject(err) : resolve(Boolean(res[0]?.theme_block_active))
//   );
// });
  const themeExtensionActive = await isThemeBlockActive({
    shop: session.shop,
    accessToken: session.accessToken,
  });

const purchases = await new Promise((resolve, reject) => {
  db.query(
    `SELECT *
     FROM purchase_table
     WHERE shop = ?
     ORDER BY purchase_id DESC`,
    [session.shop],
    (err, results) => (err ? reject(err) : resolve(results))
  );
});
  const totalProducts = await getTotalProductCount({
    shop: session.shop,
    accessToken: session.accessToken,
  });

  const purchasesWithImages = await Promise.all(
    purchases.map(async (purchase) => {
      const image = await getFirstImageREST({
        shop: session.shop,
        accessToken: session.accessToken,
        selection_type: purchase.selection_type,
        products: purchase.products,
        variants: purchase.variants,
      });

      return {
        ...purchase,
        image_url: image,

      };
    })
  );

  return json({
    purchases: purchasesWithImages,
    session_token: session.accessToken,
    session_shop: session.shop,
     themeExtensionActive,
    totalProducts
  });


};


export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();

  const purchaseName = formData.get("purchaseName");
  const lineItemText = formData.get("lineItemText");
  const depositDisplay = formData.get("depositDisplay");
  const paymentCollection = formData.get("paymentCollection") || "Manual";
  const depositType = formData.get("depositType") || "percentage";
  const depositAmount = formData.get("depositAmount") || 0;
  const payfull = formData.get("payfull") !== null;
  const deferredDue = formData.get("deferredDue");
  const intent = formData.get("_intent");
  const remainingDuedayRaw = formData.get("remainingDueday");
  const remainingDuedateRaw = formData.get("remainingDuedate");
  const selectiontype = formData.get("selectiontype");

  const productIds = formData.getAll("products");
  const variantIds = formData.getAll("variants");
  const tagValues = formData.getAll("tags");
  const excludedProductIds = formData.getAll("excludedProducts");
  const purchaseId = formData.get("purchase_id");
    const { session } = await authenticate.admin(request);
  let products = null;
  let variants = null;
  let tags = null;
  let whole = null;

  if (selectiontype === "Products") products = productIds.join(",");
  if (selectiontype === "Variants") variants = variantIds.join(",");
  if (selectiontype === "Tags") tags = tagValues.join(",");
  if (selectiontype === "Whole store") whole = excludedProductIds.join(",");

  const remainingDueday =
    deferredDue === "days" ? Number(remainingDuedayRaw) : null;

  const remainingDuedate =
    deferredDue === "date" ? remainingDuedateRaw : null;

// if (intent === "theme-active") {
//     await new Promise((resolve, reject) => {
//       db.query(
//         `
//         UPDATE purchase_table
//         SET theme_block_active = 1
//         WHERE shop = ?
//         `,
//         [session.shop],
//         err => (err ? reject(err) : resolve())
//       );
//     });

//     return json({ ok: true });
//   }
// if (intent === "theme-inactive") {
//   await new Promise((resolve, reject) => {
//     db.query(
//       `
//       UPDATE purchase_table
//       SET theme_block_active = 0
//       WHERE shop = ?
//       `,
//       [session.shop],
//       err => (err ? reject(err) : resolve())
//     );
//   });

//   return json({ ok: true });
// }

  if (intent === "delete") {
    const purchaseId = formData.get("purchase_id");

    if (!purchaseId) {
      throw new Error("Purchase ID missing");
    }

    // 1️⃣ Get selling plan group id
    const planRow = await new Promise((resolve, reject) => {
      db.query(
        `SELECT selling_plan_group_id
       FROM purchase_table
       WHERE purchase_id = ?
        AND shop = ?`,
        [purchaseId, session.shop],
        (err, res) => (err ? reject(err) : resolve(res[0]))
      );
    });

    if (!planRow?.selling_plan_group_id) {
      throw new Error("Selling plan group id missing");
    }



    // 3️⃣ Delete from Shopify
    await deleteSellingPlanGroup({
      shop: session.shop,
      accessToken: session.accessToken,
      sellingPlanGroupId: planRow.selling_plan_group_id,
    });

    // 4️⃣ Delete from DB
    await new Promise((resolve, reject) => {
      db.query(
        "DELETE FROM purchase_table WHERE purchase_id = ?",
        [purchaseId],
        (err) => (err ? reject(err) : resolve())
      );
    });
    return json({ deleted: true });

  }



  await new Promise((resolve, reject) => {
    db.query(
      `INSERT INTO purchase_table
      (purchase_option_name,line_item_text,selection_type,products,variants,tags,whole,
       deposit_options_display,payment_collection_type,deposit_type,deposit_amount,
       payin_full,deferred_due,remaining_balance_days,remaining_balance_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        purchaseName,
        lineItemText,
        selectiontype,
        products,
        variants,
        tags,
        whole,
        depositDisplay,
        paymentCollection,
        depositType,
        depositAmount,
        payfull,
        deferredDue,
        remainingDueday,
        remainingDuedate,
      ],
      (err) => (err ? reject(err) : resolve())
    );
  });

  return redirect("/app");
};



async function getFirstImageREST({
  shop,
  accessToken,
  selection_type,
  products,
  variants,
}) {
  const headers = {
    "X-Shopify-Access-Token": accessToken,
    "Content-Type": "application/json",
  };


  if (selection_type === "Products" && products) {
    const productId = products
      .split(",")[0]
      .replace("gid://shopify/Product/", "");

    const res = await fetch(
      `https://${shop}/admin/api/2024-10/products/${productId}.json`,
      { headers }
    );

    const data = await res.json();
    return data?.product?.image?.src || null;
  }


  if (selection_type === "Variants" && variants) {
    const variantId = variants
      .split(",")[0]
      .replace("gid://shopify/ProductVariant/", "");

    const variantRes = await fetch(
      `https://${shop}/admin/api/2024-10/variants/${variantId}.json`,
      { headers }
    );

    const variantData = await variantRes.json();

    if (variantData?.variant?.image?.src) {
      return variantData.variant.image.src;
    }

    const productId = variantData?.variant?.product_id;
    if (!productId) return null;

    const productRes = await fetch(
      `https://${shop}/admin/api/2024-10/products/${productId}.json`,
      { headers }
    );

    const productData = await productRes.json();
    return productData?.product?.image?.src || null;
  }

  return null;
}




export default function Index() {
  const fetcher = useFetcher();
const revalidator = useRevalidator();
  const [deleteId, setDeleteId] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const shopify = useAppBridge();
  const navigate = useNavigate();
  const { purchases, session_token, session_shop, totalProducts,themeExtensionActive} = useLoaderData();
  //const {shop_name} = useLoaderData();
  //const sess=sessionStorage.storeSession()

  const [searchParams, setSearchParams] = useSearchParams();
useEffect(() => {
  const handleFocus = () => {
    revalidator.revalidate();
  };

  window.addEventListener("focus", handleFocus);

  return () => {
    window.removeEventListener("focus", handleFocus);
  };
}, [revalidator]);
  // useEffect(() => {
  //   const toast = searchParams.get("toast");

  //   if (toast === "data-saved") {
  //     setTimeout(() => {
  //       shopify.toast.show("Purchase option created");
  //     }, 100);

  //     // remove param so toast doesn’t repeat
  //     setSearchParams({}, { replace: true });
  //   }
  // }, [searchParams, shopify, setSearchParams]);
useEffect(() => {
  const toast = searchParams.get("toast");
  if (!toast) return;

  setTimeout(() => {
    if (toast === "data-saved") {
      shopify.toast.show("Purchase option created");
    }

    if (toast === "purchase-updated") {
      shopify.toast.show("Purchase option updated");
    }
  }, 100);

  // Remove query param so it doesn't repeat on refresh
  setSearchParams({}, { replace: true });

}, [searchParams, shopify, setSearchParams]);

  const ITEMS_PER_PAGE = 4;
  const [currentPage, setCurrentPage] = useState(1);
  const [activePopoverId, setActivePopoverId] = useState(null);


  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";
  const productId = fetcher.data?.product?.id.replace(
    "gid://shopify/Product/",
    "",
  );

  const ORDERS_ADMIN_URL = `https://${session_shop}/admin/orders`;

  useEffect(() => {
    console.log("rrrtt", session_token);
    console.log("shop", session_shop);
console.log("themeExtensionActive:", themeExtensionActive);

    if (productId) {
      shopify.toast.show("Product created");
    }
  }, [productId, shopify]);
  const generateProduct = () => fetcher.submit({}, { method: "POST" });
  const totalItems = purchases.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const paginatedPurchases = purchases.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );
  const isDeleting =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("_intent") === "delete";



  console.log("TOTAL PRODUCTS:", totalProducts);


  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data?.deleted === true
    ) {
      shopify.toast.show("Purchase option deleted");

      // 🔒 force-close modal
      setDeleteOpen(false);
      setDeleteId(null);

      // 🔄 refresh list
      fetcher.load("/app");
    }
  }, [fetcher.state, fetcher.data, shopify]);


  return (
    <Page >
      <TitleBar title="Downpay">

        {/* <Modal
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          title="Delete purchase option?"
          primaryAction={{
            content: "Delete",
            destructive: true,
            onAction: () => {
              const fd = new FormData();
              fd.set("_intent", "delete");
              fd.set("purchase_id", deleteId);

              fetcher.submit(fd, { method: "post" });

              setDeleteOpen(false);
              setDeleteId(null);
            },
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setDeleteOpen(false),
            },
          ]}
        >
          <Modal.Section>
            <Text>This can't be undone.</Text>
          </Modal.Section>
        </Modal> */}
        <Modal
          open={deleteOpen}
          onClose={() => {
            if (!isDeleting) setDeleteOpen(false);
          }}
          title="Delete purchase option?"
          primaryAction={{
            content: "Delete",
            destructive: true,
            loading: isDeleting,
            disabled: isDeleting,
            onAction: () => {
              const fd = new FormData();
              fd.set("_intent", "delete");
              fd.set("purchase_id", deleteId);

              fetcher.submit(fd, { method: "post" });
            },
          }}
          secondaryActions={[
            {
              content: "Cancel",
              disabled: isDeleting,
              onAction: () => setDeleteOpen(false),
            },
          ]}
        >
          <Modal.Section>
            <Text>This can't be undone.</Text>
          </Modal.Section>
        </Modal>



        <button variant="primary" onClick={generateProduct}>
          Generate a product
        </button>
      </TitleBar>
      <BlockStack gap="500">

        <div style={{ marginTop: "40px" }}>

          <Layout>
            <Layout.Section>
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingXl">Dashboard</Text>

                <Button variant="primary" onClick={() => navigate('/app/purchase')}>
                  Create purchase option
                </Button>
              </InlineStack>
            </Layout.Section>



            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="center" gap="500" blockAlign="center">


                    <Box width="5%">
                      <BlockStack align="center" gap="025">
                        <Icon source={CalendarIcon} tone="base" />
                        <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                          prior 7<br />days
                        </Text>
                      </BlockStack>
                    </Box>


                    <Box
                      background="border"
                      width="1px"
                      minHeight="50px"
                      borderRadius="050"
                    />

                    <Box width="25%">
                      <BlockStack align="center" gap="050">
                        <Text as="h2" variant="headingMd">Total Downpay Sales</Text>
                        <InlineStack align="center" gap="100">
                          <Text as="h2" variant="headingLg">$0.00</Text>

                          <Box
                            style={{
                              flex: 1,
                              height: 4,
                              background: 'var(--p-color-border-info)',
                              borderRadius: 2,
                              marginTop: '8px'
                            }}
                          />
                        </InlineStack>
                      </BlockStack>
                    </Box>

                    <Box
                      background="border"
                      width="1px"
                      minHeight="50px"
                      borderRadius="050"
                    />

                    <Box width="25%">
                      <BlockStack align="center" gap="050">
                        <Text as="h2" variant="headingMd">Total Downpay Orders</Text>
                        <InlineStack align="center" gap="100">
                          <Text as="h2" variant="headingLg">0</Text>

                          <Box
                            style={{
                              flex: 1,
                              height: 4,
                              background: 'var(--p-color-border-info)',
                              borderRadius: 2,
                              marginTop: '8px'
                            }}
                          />
                        </InlineStack>
                      </BlockStack>
                    </Box>
                    <Box
                      background="border"
                      width="1px"
                      minHeight="50px"
                      borderRadius="050"
                    />



                    <Box width="25%">
                      <BlockStack align="center" gap="050">
                        <Text as="h2" variant="headingMd">Downpay AOV</Text>
                        <InlineStack align="center" gap="100">
                          <Text as="h2" variant="headingLg">$0.00</Text>

                          <Box
                            style={{
                              flex: 1,
                              height: 4,
                              background: 'var(--p-color-border-info)',
                              borderRadius: 2,
                              marginTop: '8px'
                            }}
                          />
                        </InlineStack>
                      </BlockStack>
                    </Box>

                  </InlineStack>
                </BlockStack>
              </Card>

            </Layout.Section>



            <Layout.Section>
              <BlockStack>
<Text as="h1" variant="headingSm">
  Theme extension block{" "}
  {themeExtensionActive ? (
    <Badge tone="success">Active</Badge>
  ) : (
    <Badge tone="critical">Inactive</Badge>
  )}
</Text>
{!themeExtensionActive && (
<InlineStack  gap="100" align="start">

<Text as="span">Downpay theme extensions may not be enabled.</Text>

  <Button
 variant="plain"
    onClick={() =>
      window.open(
       `https://${session_shop}/admin/themes/current/editor?template=product&addAppBlockId=c6484a6284a9cfd6bf8d72ac8b120813/star_rating&target=newAppsSection`,
      "_blank"
      )
    }

  >
 open the theme editor
  </Button>
<Text as="span">  to ensure Downpay is properly installed in your theme</Text>
</InlineStack>
)}


              </BlockStack>
            </Layout.Section>




            <Layout sizes={{ lg: { primaryContentWidth: '70%', secondaryContentWidth: '30%' } }}>
              <Layout.Section>
                <Box style={{ marginTop: "var(--p-space-600)" }}>

                  {purchases.length === 0 ? (

                    <Card>
                      <Box padding="600">
                        <BlockStack gap="500" inlineAlign="center">
                          <Image source={logo} style={{ width: 120, height: 120 }} />
                          <Text as="h2" variant="headingLg">Welcome to Downpay</Text>
                          <Text>To get started, follow our guided setup.</Text>
                          <Button primary>Begin Setup</Button>
                          <Text>If you want to set Downpay up manually, you can also start by</Text>
                          <Button variant="plain" onClick={() => navigate("/app/purchase")}>
                            creating a purchase option
                          </Button>
                        </BlockStack>
                      </Box>
                    </Card>
                  ) : (

                    <Card>
                      <ResourceList
                        resourceName={{ singular: "purchase option", plural: "purchase options" }}
                        items={paginatedPurchases}

                        renderItem={(item) => {
                          const {
                            purchase_id,
                            purchase_option_name,
                            selection_type,
                            products,
                            variants,
                            tags,
                            whole,
                            deposit_type,
                            deposit_amount,
                            remaining_balance_days,
                            remaining_balance_date,

                            image_url,
                          } = item;



                          const excludedCount =
                            whole && whole.length > 0 ? whole.split(",").length : 0;

                          let remainingProducts = null;

                          if (selection_type === "Whole store" && typeof totalProducts === "number") {
                            remainingProducts = Math.max(totalProducts - excludedCount, 0);
                          }


                          const remainingText = remaining_balance_date
                            ? `Remaining balance due: ${new Date(remaining_balance_date).toDateString()}`
                            : remaining_balance_days
                              ? `Remaining balance due: ${remaining_balance_days} days after checkout`
                              : "";

                          let detailsText = "";
                          let mediaSource = alien;

                          if (selection_type === "Products" && products) {
                            detailsText = `${products.split(",").length} products available for sale with this option`;
                            mediaSource = image_url || alien;


                          } else if (selection_type === "Variants" && variants) {
                            detailsText = `${variants.split(",").length} variants available for sale with this option`;
                            mediaSource = image_url || alien;


                          } else if (selection_type === "Tags" && tags) {
                            detailsText = `${tags.split(",").length} tagged products available for sale with this option`;
                            mediaSource = alien;
                          } else if (selection_type === "Whole store") {
                            detailsText = remainingProducts !== null
                              ? `Applied to all products ( ${remainingProducts} products available , excluded ${excludedCount})`
                              : `Whole store selected`;
                            mediaSource = image_url || alien;
                          }


                          return (
                            <ResourceItem
                              id={purchase_id}
                              media={
                                <Thumbnail
                                  source={mediaSource}
                                  alt={purchase_option_name}
                                />
                              }
                            >
                              <BlockStack gap="200">
                                <Box>
                                  <Text variant="headingSm" as="h3">{purchase_option_name}</Text>
                                  {/* <Text as="p">
                                    Deposit at checkout: {deposit_amount}
                                    {deposit_type === "percentage" ? "%" : "$"}
                                  </Text> */}
                                  <Text as="p">
                                    Deposit at checkout:{" "}
                                    {deposit_type === "percentage"
                                      ? `${deposit_amount}%`
                                      : `$${Number(deposit_amount).toFixed(2)}`}
                                  </Text>

                                  {remainingText && <Text tone="subdued" as="p">{remainingText}</Text>}
                                  {detailsText && <Text tone="subdued" as="p">{detailsText}</Text>}
                                </Box>

                                <ButtonGroup>
                                  <Popover
                                    active={activePopoverId === purchase_id}
                                    activator={
                                      <Button
                                        disclosure
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setActivePopoverId(
                                            activePopoverId === purchase_id ? null : purchase_id
                                          );
                                        }}
                                      >
                                        More actions
                                      </Button>
                                    }
                                    onClose={() => setActivePopoverId(null)}
                                  >
                                    <ActionList
                                      items={[
                                        {
                                          content: "View orders",
                                          onAction: () => {
                                            window.open(`https://${session_shop}/admin/orders`, "_top");
                                          },
                                        },
                                        {
                                          content: "Manage payments",
                                          onAction: () => {
                                            navigate(`/app/payments/${purchase_id}`);
                                            setActivePopoverId(null);
                                          },
                                        },
                                        {
                                          content: "Delete",
                                          destructive: true,

                                          onAction: () => {
                                            setDeleteId(purchase_id);
                                            if (isDeleting) return;
                                            setDeleteOpen(true);
                                          }

                                        },
                                      ]}
                                    />
                                  </Popover>

                                  <Button
                                    variant="primary"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigate(`/app/pur/${purchase_id}`);
                                    }}
                                  >
                                    Customize
                                  </Button>
                                </ButtonGroup>

                              </BlockStack>
                            </ResourceItem>

                          );
                        }}


                      />

                      {totalPages > 1 && (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
                          <Pagination
                            hasPrevious={currentPage > 1}
                            hasNext={currentPage < totalPages}
                            onPrevious={() => setCurrentPage((prev) => prev - 1)}
                            onNext={() => setCurrentPage((prev) => prev + 1)}
                          />
                        </div>
                      )}

                    </Card>
                  )}

                </Box>
              </Layout.Section>
              <Layout.Section variant="oneThird" >
                <Box style={{ marginTop: "var(--p-space-600)" }}>

                  <Card>
                    <Box padding="400" >
                      <BlockStack gap="200" inlineAlign="start">


                        <InlineStack gap="150" align="start" blockAlign="center">
                          <Icon source={QuestionCircleIcon} tone="base" />
                          <Text variant="headingSm">Help center</Text>
                        </InlineStack>

                        <Text>Everything you need to get started with Downpay.</Text>
                        <Button fullWidth={false}>View help center</Button>

                      </BlockStack>
                    </Box>
                  </Card>
                </Box>
                <Box paddingBlock="300" />
                <Card>
                  <Box padding="400">
                    <BlockStack gap="200" inlineAlign="start">


                      <InlineStack gap="150" align="start" blockAlign="center">
                        <Icon source={MagicIcon} tone="base" />
                        <Text variant="headingSm">Explore more features</Text>
                      </InlineStack>

                      <Text>Get the most out of Downpay with our advanced features guide.</Text>
                      <Button fullWidth={false}>Explore features</Button>

                    </BlockStack>
                  </Box>
                </Card>
                <Box paddingBlock="300" />
                <Card>
                  <Box padding="400">
                    <BlockStack gap="200" inlineAlign="start">


                      <InlineStack gap="150" align="start" blockAlign="center">
                        <Icon source={NoteIcon} tone="base" />
                        <Text variant="headingSm">Change log</Text>
                      </InlineStack>

                      <Text>Stay updated with our latest features and improvements.

                      </Text>
                      <Button fullWidth={false}>View Change log</Button>

                    </BlockStack>
                  </Box>
                </Card>
              </Layout.Section>

            </Layout>

          </Layout>
        </div>
      </BlockStack>
    </Page>
  );
}
