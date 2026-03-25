import {
    Box, Card, Layout, Link, Listbox, Page, Text, InlineStack, TextField, BlockStack, Button, Icon, RadioButton, Checkbox,
    Banner,
    DatePicker,
    Popover,
    Combobox,
    Tag,
    Thumbnail,
    Badge,
    Loading, Spinner
} from "@shopify/polaris";


import { TitleBar } from "@shopify/app-bridge-react";
import { useAppBridge } from "@shopify/app-bridge-react";
// import { ResourcePicker } from "@shopify/app-bridge/actions";
import { useState, useCallback, useMemo, useRef ,useEffect} from "react";
import { useNavigate} from "@remix-run/react";
import { json } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { redirect } from "@remix-run/node";
import {
    AlertCircleIcon,  ImageIcon
} from '@shopify/polaris-icons';
 import axios from "axios";
import { getProductIdsByTags,getAllProductIds } from "./api.productbytag";
import { useFetcher, useLoaderData } from "@remix-run/react";

function chunkArray(arr, size = 250) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

const CREATE_SELLING_PLAN = `
mutation createSellingPlanGroup(
  $input: SellingPlanGroupInput!
  $resources: SellingPlanGroupResourceInput
) {
  sellingPlanGroupCreate(input: $input, resources: $resources) {
    sellingPlanGroup {
      id
      sellingPlans(first: 1) {
        edges {
          node {
            id
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

// export const loader = async ({ request }) => {
//   const { session } = await authenticate.admin(request);

//   return json({
//     shop: session.shop,
//   });
// };

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  let hasNextPage = true;
  let cursor = null;
  const tagSet = new Set();

  while (hasNextPage) {
    const response = await admin.graphql(GET_PRODUCT_TAGS, {
      variables: { cursor },
    });

    const result = await response.json();

    const products = result.data.products.edges;
    products.forEach(({ node }) => {
      node.tags.forEach(tag => tagSet.add(tag));
    });

    hasNextPage = result.data.products.pageInfo.hasNextPage;
    cursor = result.data.products.pageInfo.endCursor;
  }
 console.timeEnd("NAVIGATE_TIME");
  return json({
    shop: session.shop,
    tags: Array.from(tagSet).sort(),
  });
};

export const action = async ({ request }) => {
    // ✅ Import db dynamically inside the server-side function
    const db = (await import('../Utils/db.createserver')).default;
    const {session, admin } = await authenticate.admin(request);
    console.time("ACTION_TOTAL");

      console.time("FORM_PARSE");
    const formData = await request.formData();

    // Extract form values
    const purchaseName = formData.get("purchaseName");
    const lineItemText = formData.get("lineItemText");
    const depositDisplay = formData.get("depositDisplay");
    const paymentCollection = formData.get("paymentCollection") || "Manual";
    const depositType = formData.get("depositType") || "percentage";
    const depositAmount = Number(formData.get("depositAmount") || 0);
    const payfull = formData.has("payfull");


    const deferredDue =
        formData.get("deferredDue") === "date" ? "date" : "days";



    const remainingDuedayRaw = formData.get("remainingDueday");
    const remainingDuedateRaw = formData.get("remainingDuedate");
    const selectiontype = formData.get("selectiontype");

    const productIds = formData.getAll("products");
    const variantIds = formData.getAll("variants");
    const tagValues = formData.getAll("tags");
    const excludedProductIds = formData.getAll("excludedProducts");
let finalProductIds = productIds;

if (selectiontype === "Tags" && tagValues.length > 0) {
  finalProductIds = await getProductIdsByTags({
    request,
    tags: tagValues,
  });
}
  console.timeEnd("FORM_PARSE");
    if (selectiontype === "Variants" && variantIds.length === 0) {
        throw new Error("At least one variant is required");
    }
    const products = selectiontype === "Products" && productIds.length
        ? productIds.join(",")
        : "null";

    const variants = selectiontype === "Variants" && variantIds.length
        ? variantIds.join(",")
        : "null";

    const tags = selectiontype === "Tags" && tagValues.length
        ? tagValues.join(",")
        : "null";

    const whole = selectiontype === "Whole store" && excludedProductIds.length
        ? excludedProductIds.join(",")
        : "null";
    const remainingDueday =
        deferredDue === "days"
            ? Number(formData.get("remainingDueday") ?? 90)
            : null;

    const remainingDuedate =
        deferredDue === "date"
            ? formData.get("remainingDuedate") ?? new Date().toISOString().split("T")[0]
            : null;

            
if (selectiontype === "Whole store") {

    const allProductIds = await getAllProductIds({ admin });

    finalProductIds = allProductIds.filter(id => !excludedProductIds.includes(id));
}



    for (const [key, value] of formData.entries()) {
        console.log(key, value);
    }

    console.log("DB Insert values:", { remainingDueday, remainingDuedate });
    let remainingBalanceConfig = {};

    if (deferredDue === "days") {
        remainingBalanceConfig = {
            remainingBalanceChargeTrigger: "TIME_AFTER_CHECKOUT",
            remainingBalanceChargeTimeAfterCheckout: `P${remainingDueday}D`,
        };
    }

    if (deferredDue === "date") {
        remainingBalanceConfig = {
            remainingBalanceChargeTrigger: "EXACT_TIME",
            remainingBalanceChargeExactTime: `${remainingDuedate}T00:00:00Z`,
        };
    }
    if (deferredDue === "days" && !remainingDueday) {
        throw new Error("Remaining balance days missing");
    }

    if (deferredDue === "date" && !remainingDuedate) {
        throw new Error("Remaining balance date missing");
    }

    // for tags

    const variables = {
        input: {
            name: lineItemText,
            appId: "newappid",
            merchantCode: purchaseName.toLowerCase().replace(/\s+/g, "_"),
            options: ["Payment option"],
            sellingPlansToCreate: [
                {
                    name: lineItemText,
                    options: ["Deposit"],
                    category: "PRE_ORDER",
                    description: "You will be charged a deposit today and the remaining balance before delivery.",
                    billingPolicy: {
                        fixed: {
                            checkoutCharge:
                                depositType === "percentage"
                                    ? {
                                        type: "PERCENTAGE",
                                        value: { percentage: Number(depositAmount) },
                                    }
                                    : {
                                        type: "PRICE",
                                        value: { fixedValue: Number(depositAmount) },
                                    },
                            ...remainingBalanceConfig,
                        },
                    },



                    inventoryPolicy: {
                        reserve: "ON_SALE",
                    },
                    deliveryPolicy: {
                        fixed: {
                            fulfillmentTrigger: "ASAP",
                        },
                    },
                },
            ],

        },
        // resources: {
        //   productIds: finalProductIds,
        //     productVariantIds: variantIds,
        // },
    };

    const response = await admin.graphql(CREATE_SELLING_PLAN, {
        variables,
    });

    const result = await response.json();

    const errors =
        result.data?.sellingPlanGroupCreate?.userErrors;

    if (errors?.length) {
        console.error(errors);
        return json({ success: false, error: errors[0].message });
    }

    const sellingPlanGroupId =
        result.data.sellingPlanGroupCreate.sellingPlanGroup.id;

    const sellingPlanId =
        result.data.sellingPlanGroupCreate.sellingPlanGroup
            .sellingPlans.edges[0].node.id;

if (finalProductIds?.length) {
  const productChunks = chunkArray(finalProductIds);

  for (const chunk of productChunks) {
    const res = await admin.graphql(
      `
      mutation addProducts($groupId: ID!, $productIds: [ID!]!) {
        sellingPlanGroupAddProducts(
          id: $groupId
          productIds: $productIds
        ) {
          userErrors {
            message
          }
        }
      }
      `,
      {
        variables: {
          groupId: sellingPlanGroupId,
          productIds: chunk,
        },
      }
    );

    const json = await res.json();

    if (json.data.sellingPlanGroupAddProducts.userErrors.length) {
      console.error(json.data.sellingPlanGroupAddProducts.userErrors);
    }
  }
}
if (variantIds?.length) {
  const variantChunks = chunkArray(variantIds);

  for (const chunk of variantChunks) {
    const res = await admin.graphql(
      `
      mutation addVariants($id: ID!, $variantIds: [ID!]!) {
        sellingPlanGroupAddProductVariants(
          id: $id,
          productVariantIds: $variantIds
        ) {
          userErrors {
            message
          }
        }
      }
      `,
      {
        variables: {
          id: sellingPlanGroupId,
          variantIds: chunk,
        },
      }
    );

    const json = await res.json();

    if (json.data.sellingPlanGroupAddProductVariants.userErrors.length) {
      console.error(json.data.sellingPlanGroupAddProductVariants.userErrors);
    }
  }
}

console.timeEnd("ACTION_TOTAL");

    try {
        await new Promise((resolve, reject) => {
            db.query(
                `INSERT INTO purchase_table (
                shop,
          purchase_option_name,
          line_item_text,
          selection_type,
          products,
          variants,
          tags,
          whole,
          deposit_options_display,
          payment_collection_type,
          deposit_type,
          deposit_amount,
          payin_full,
          deferred_due,
          app_id,
          remaining_balance_days,
          remaining_balance_date,
            selling_plan_group_id,
        selling_plan_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                      session.shop,
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
                    payfull ? 1 : 0,
                    deferredDue,
                    "newappid",
                    remainingDueday,
                    remainingDuedate,
                    sellingPlanGroupId,
                    sellingPlanId,
                ],


                (err, result) => {
                    if (err) return reject(err);

                    // ✅ ADD THIS
                    console.log("INSERT RESULT:", result);

                    resolve(result);
                }

            );
        }); console.log({
            purchaseName,
            lineItemText,
            selectiontype,
            products,
            variants,
            tags,
            whole,
        });
        await new Promise((resolve, reject) => {
            db.query(
                `UPDATE purchase_table
     SET app_id = ?
     WHERE app_id IS NULL OR app_id = ''`,
                ["newappid"],
                (err, result) => {
                    if (err) return reject(err);
                    console.log("Updated old records with new appId:", result.affectedRows);
                    resolve(result);
                }
            );
        });

        console.log("Data inserted successfully!");
     return redirect("/app?toast=data-saved");
    } catch (error) {
        console.error("DB insert error:", error);
        return json({ success: false, error: error.message });

    }
};



export default function NewPage() {
     const { shop } = useLoaderData();
    const fetcher = useFetcher();
    const formRef = useRef(null);



const isSaving = fetcher.state !== "idle";


// Track if any changes were made to the form
const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    const [productPrice, setProductPrice] = useState("0")

    const [selected, setSelected] = useState("always")
    const [text, setText] = useState("Deposit only due at checkout");
    const [open, setOpen] = useState(false);
    const [selectedType, setSelectedType] = useState("Products");
    const [depositType, setDepositType] = useState("percentage");
    const [depositAmount, setDepositAmount] = useState("");
    const [paymentCollection, setPaymentCollection] = useState("Manual");

    const [allowFullPayment, setAllowFullPayment] = useState(true);
    const [dueDateType, setDueDateType] = useState("days");
    const [days, setDays] = useState("90");
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [errors, setErrors] = useState({});


    const [{ month, year }, setViewDate] = useState({
        month: selectedDate.getMonth(),
        year: selectedDate.getFullYear(),
    });

    const handleMonthChange = useCallback(
        (month, year) => setViewDate({ month, year }),
        [],
    );
    const [popoverActive, setPopoverActive] = useState(false);
    // const ALL_TAGS = [
    //     "Accessory",
    //     "Archived",
    //     "Premium",
    //     "Snow",
    //     "Snowboard",
    //     "Sport",
    //     "Winter",
    //     "Bicycle",
    //     "Black"
    // ];
   const {tags: ALL_TAGS } = useLoaderData();

    const [purchaseName, setPurchaseName] = useState("");
    const [selectedTags, setSelectedTags] = useState([]);
    const [tagInput, setTagInput] = useState("");
    const [selectedProducts, setSelectedProducts] = useState([]);
    const [selectedVariants, setSelectedVariants] = useState([]);
    const [excludedProducts, setExcludedProducts] = useState([]);

    const togglePopover = () => setPopoverActive((active) => !active);

    const navigate = useNavigate();

    const app = useAppBridge();
    const URL =
        `https://${shop}/admin/products/`;
    // Compute the prices for selected products or variants
    const selectedPrices = useMemo(() => {
        if (selectedType === "Products") {
            return selectedProducts.map(p =>
                Number(p.variants?.[0]?.price || 0)
            );
        }

        if (selectedType === "Variants") {
            return selectedVariants.map(v => Number(v.price || 0));
        }

        return [];
    }, [selectedProducts, selectedVariants, selectedType]);


// Whenever any field changes, mark as unsaved
const handleChange = (setter) => (value) => {
  setter(value);
  setHasUnsavedChanges(true);
};


    const getNumericId = (gid) => {
        if (!gid) return null;
        if (typeof gid === "number") return gid;
        if (typeof gid === "string") return gid.includes("/") ? gid.split("/").pop() : gid;
        return null;
    };



    const calculateDeposit = (price) => {
        if (!price || !depositAmount) return 0;

        return depositType === "percentage"
            ? (price * Number(depositAmount)) / 100
            : Number(depositAmount);
    };

    const handleViewProduct = (productId) => {
        const numericId = getNumericId(productId);
        if (!numericId) return;
        const productUrl = `${URL}${numericId}`;
        window.open(productUrl, "_blank");
    };


    const handleOpenPicker = async () => {
        try {
            const result = await shopify.resourcePicker({
                type: "product",
                multiple: true,
                filter: { variants: false },
                initialSelectionIds: selectedProducts.map(p => ({ id: p.id })),
            });

            if (result?.selection) {
                setSelectedProducts(result.selection);
            }
            const firstProduct = result.selection[0];
            const firstVariantPrice =
                Number(firstProduct.variants?.[0]?.price) || 0;

            setProductPrice(firstVariantPrice);
        } catch (error) {
            console.error("Error opening product picker:", error);
        }
    };

    const handleExcludeProductPicker = async () => {
        try {
            const result = await shopify.resourcePicker({
                type: "product",
                multiple: true,
                filter: { variants: false },
                initialSelectionIds: excludedProducts.map(p => ({ id: p.id })),
            });

            if (result?.selection) {
                setExcludedProducts(result.selection);
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

            if (!selected?.selection) return;

            const variants = selected.selection.flatMap((product) =>
                product.variants.map((variant) => ({
                    id: variant.id,
                    title: variant.title,
                    option1: variant.selectedOptions?.[0]?.value || "Default Title",
                    price: Number(variant.price),
                    image: variant.image,
                    productId: product.id,
                    productTitle: product.title,
                    productImage: product.image,
                    productStatus: product.status,
                }))
            );

            setSelectedVariants((prev) => {
                const existingIds = new Set(prev.map(v => v.id));
                const merged = [...prev];

                variants.forEach(v => {
                    if (!existingIds.has(v.id)) merged.push(v);
                });

                if (merged.length > 0) {
                    setProductPrice(merged[0].price);
                }

                return merged;


            });
           
        } catch (error) {
            console.error("Error opening variant picker:", error);
        }
    };



    const handleTagSelect = useCallback(
        (value) => {
            if (!selectedTags.includes(value)) {
                setSelectedTags([...selectedTags, value]);
            }
            setTagInput("");
        },
        [selectedTags]
    );

    const handleRemoveTag = useCallback(
        (tag) => () => {
            setSelectedTags((prev) => prev.filter((t) => t !== tag));
        },
        []
    );

    const filteredTags = useMemo(() => {
        return ALL_TAGS.filter(
            (tag) =>
                tag.toLowerCase().includes(tagInput.toLowerCase()) &&
                !selectedTags.includes(tag)
        );
    }, [tagInput, selectedTags, ALL_TAGS]);

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
        {
            errors.selection && (
                <Text tone="critical" as="p">
                    {errors.selection}
                </Text>
            )
        }

        // if (selectedType === "Products")
        //     return (
        //         <>
        //             <Text>Select products to enable this purchase option for them</Text>

        //             <Box marginTop="400">
        //                 {selectedProducts.map((product) => (
        //                     <Box
        //                         key={product.id}
        //                         padding="300"
        //                         borderBlockEndWidth="025"
        //                         borderColor="border"
        //                     >
        //                         <InlineStack align="space-between">
        //                             <InlineStack gap="300">
        //                                 <Thumbnail
        //                                     source={product.images?.[0]?.originalSrc}
        //                                     alt={product.title}
        //                                 />
        //                                 <InlineStack gap="200">
        //                                     <Text>{product.title}</Text>
        //                                     <Badge tone="success">Active</Badge>
        //                                 </InlineStack>
        //                             </InlineStack>

        //                             <Button variant="plain" onClick={() => handleViewProduct(product.id)}>View</Button>
        //                         </InlineStack>
        //                     </Box>
        //                 ))}
        //             </Box>
        //             <Box style={{ marginTop: "var(--p-space-400)" }}>
        //                 <Button onClick={handleOpenPicker}>Select products</Button>
        //             </Box>
        //         </>
        //     );

        if (selectedType === "Products")
            return (
                <>
                    <Text>Select products to enable this purchase option for them</Text>

                    <Box marginTop="400">
                        {selectedProducts.map((product) => {
                            const { tone, label } = getStatusBadgeProps(product.status);

                            return (
                                <Box
                                    key={product.id}
                                    padding="300"
                                    borderBlockEndWidth="025"
                                    borderColor="border"
                                >
                                    <InlineStack align="space-between">
                                        <InlineStack gap="300">
                                            <Thumbnail
                                                source={product.images?.[0]?.originalSrc}
                                                alt={product.title}
                                            />

                                            <InlineStack gap="200" blockAlign="center">
                                                <Text>{product.title}</Text>
                                                <Badge tone={tone}>{label}</Badge>
                                            </InlineStack>
                                        </InlineStack>

                                        <Button
                                            variant="plain"
                                            onClick={() => handleViewProduct(product.id)}
                                        >
                                            View
                                        </Button>
                                    </InlineStack>
                                </Box>
                            );
                        })}
                    </Box>

                    <Box style={{ marginTop: "var(--p-space-400)" }}>
                        <Button onClick={handleOpenPicker}>Select products</Button>
                    </Box>
                </>
            );

        if (selectedType === "Variants")
            return (
                <>
                    <Text>
                        Select product variants to enable this purchase option for them
                    </Text>

                    <Box marginTop="400">
                        {selectedVariants.length > 0 && (
                            <Box padding="300" borderBlockEndWidth="025" borderColor="border">
                                {Object.entries(
                                    selectedVariants.reduce((acc, variant) => {
                                        const productKey = variant.productTitle;
                                        if (!acc[productKey]) acc[productKey] = [];
                                        acc[productKey].push(variant);
                                        return acc;
                                    }, {})
                                ).map(([productTitle, variants]) => {
                                    let productImage = "https://via.placeholder.com/50";
                                    if (variants[0]?.image && variants[0].image.originalSrc) {
                                        productImage = variants[0].image.originalSrc;
                                    }
                                    const variantTitles = variants.map((v) => v.title).join(", ");

                                    const productId = variants[0].productId;
                                    return (
                                        <Box key={productTitle} padding="300" borderBlockEndWidth="025" borderColor="border">
                                            <InlineStack align="space-between" blockAlign="center">

                                                <InlineStack gap="200" blockAlign="center">
                                                 <Box
  background="bg-surface-secondary"
  borderRadius="200"
  padding="200"
  inline
>
  <Icon source={ImageIcon}
  tone="base"/>
</Box>

                                                    <Text variant="headingSm">
                                                        {productTitle} — <span style={{ fontWeight: 400 }}>{variantTitles}</span>
                                                    </Text>
                                                </InlineStack>

                                                <InlineStack gap="200" blockAlign="center">
                                                    {(() => {
                                                        const { tone, label } = getStatusBadgeProps(variants[0]?.productStatus);
                                                        return <Badge tone={tone}>{label}</Badge>;
                                                    })()}

                                                    <Button key={productId}
                                                        variant="secondary"
                                                        onClick={() => handleViewProduct(productId)}>View</Button>
                                                </InlineStack>
                                            </InlineStack>
                                        </Box>
                                    );
                                })}




                            </Box>
                        )}


                    </Box>

                    <Box style={{ marginTop: "var(--p-space-400)" }}>
                        <Button onClick={handleOpenPickervariant}>
                            Select Variants
                        </Button>
                    </Box>
                </>
            );


        if (selectedType === "Tags")
            return (
                <>
                    <Text as="span" variant="bodyMd">
                        Enter product tags to enable this purchase option for them
                    </Text>


                    <Box marginTop="400">
                        <Combobox
                            activator={
                                <Combobox.TextField
                                    labelHidden
                                    value={tagInput}
                                    onChange={setTagInput}
                                    placeholder="Search tags"
                                    autoComplete="off"
                                />
                            }
                        >
                            {filteredTags.length > 0 && (
                                <Listbox onSelect={handleTagSelect}>
                                    {filteredTags.map((tag) => (
                                        <Listbox.Option key={tag} value={tag}>
                                            {tag}
                                        </Listbox.Option>
                                    ))}
                                </Listbox>
                            )}
                        </Combobox>
                    </Box>


                    {selectedTags.length > 0 && (
                        <Box marginTop="200">
                            <InlineStack gap="200">
                                {selectedTags.map((tag) => (
                                    <Tag key={tag} onRemove={handleRemoveTag(tag)}>
                                        {tag}
                                    </Tag>
                                ))}
                            </InlineStack>
                        </Box>
                    )}

                    <Box marginTop="400">
                        <Text variant="bodyMd" tone="subdued">
                            Adding products by tag starts after saving and the time it takes depends
                            on the amount. See how many products are associated with each purchase
                            option on the purchase options overview page.
                        </Text>
                    </Box>
                </>
            );


        if (selectedType === "Whole store")
            return (
                <>
                    <Text>Selecting this option will be applied on the entire store. You may wish to exclude some items, such as gift cards.</Text>
                            <Box style={{marginTop:'20px',fontSize: 'var(--p-font-size-500)'}}>
                                 <Text as="h1" variant="headingMd">Excluded Products</Text>
                            </Box>
                    <Box marginTop="400">
                        {excludedProducts.map((product) => (
                            <Box key={product.id} padding="300" borderBlockEndWidth="025">
                                <InlineStack align="space-between">
                                    <InlineStack gap="300">
                                        <Thumbnail
                                            source={product.images?.[0]?.originalSrc}
                                            alt={product.title}
                                        />
                                        <InlineStack gap="200">
                                            <Text>{product.title}</Text>
                                            {(() => {
                                                const { tone, label } = getStatusBadgeProps(product.status);
                                                return <Badge tone={tone}>{label}</Badge>;
                                            })()}

                                        </InlineStack>
                                    </InlineStack>
                                    <Button variant="plain" onClick={() => handleViewProduct(product.id)}>View</Button>
                                </InlineStack>
                            </Box>
                        ))}

                    </Box>
           
                    <Box style={{ marginTop: "var(--p-space-400)" }}>
                        <Button onClick={handleExcludeProductPicker}>Select products to exclude</Button>

                    </Box>
                </>
            );

        return null;
    };


const discardChanges = () => {
  setHasUnsavedChanges(false);

  // simplest + safest way
  window.location.reload();
};

    const validateForm = () => {
        const newErrors = {};


        if (!purchaseName.trim()) {
            newErrors.purchaseName = "Purchase option name is required";
        }


        if (!depositAmount || Number(depositAmount) <= 0) {
            newErrors.depositAmount = "Deposit amount must be greater than 0";
        }

        if (selectedType === "Products" && selectedProducts.length === 0) {
            newErrors.selection = "Please select at least one product";
        }

        if (selectedType === "Variants" && selectedVariants.length === 0) {
            newErrors.selection = "Please select at least one variant";
        }

        if (selectedType === "Tags" && selectedTags.length === 0) {
            newErrors.selection = "Please add at least one tag";
        }

        // Whole store → valid by default
        // If you want to require exclusions, uncomment below:
        /*
        if (selectedType === "Whole store" && excludedProducts.length === 0) {
          newErrors.selection = "Please select products to exclude";
        }
        */

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };
useEffect(() => {
  if (fetcher.state === "idle" && fetcher.data?.success) {
        console.time("NAVIGATE_TIME");
    setHasUnsavedChanges(false);
    navigate("/app?toast=data-saved");
  }
}, [fetcher.state, fetcher.data, navigate]);




    return (
        <>
        <Box style={{ margin: "25px", "--p-space-050": "20px" ,textDecoration:'none'}}>

            <Text as="h2" variant="headingSm"><Link url="/app" removeUnderline tone="base" >Dashboard </Link>/ Purchase option</Text>
        </Box>
        <Page> 
     {/* JSX */}
 



            
            <TitleBar title="Purchase page"/>
            <fetcher.Form data-save-bar
                method="post"
                onSubmit={(e) => {
                    if (!validateForm()) {
                        e.preventDefault();
                    }
                }}
            >

                <Layout>
                    <Layout.Section>
                        <BlockStack>
                            <Text as="h2" variant="headingLg">Purchase Option</Text>
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
                                          onChange={handleChange(setPurchaseName)}  // NEW
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
                                            <Button
                                                type="button"
                                                onClick={() => setSelectedType("Products")}
                                                variant={selectedType === "Products" ? "primary" : undefined}
                                            >
                                                Products
                                            </Button>
                                            <Button
                                                type="button"
                                                onClick={() => setSelectedType("Variants")}
                                                variant={selectedType === "Variants" ? "primary" : undefined}
                                            >
                                                Variants
                                            </Button>
                                            <Button
                                                type="button"
                                                onClick={() => setSelectedType("Tags")}
                                                variant={selectedType === "Tags" ? "primary" : undefined}
                                            >
                                                Tags
                                            </Button>
                                            <Button
                                                type="button"
                                                onClick={() => setSelectedType("Whole store")}
                                                variant={selectedType === "Whole store" ? "primary" : undefined}
                                            >Whole store
                                            </Button>
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
                                    name="payfull"
                                    onChange={(checked) => setAllowFullPayment(checked)}
                                    helpText="Checked means customers can either leave a deposit or pay in full up front"
                                />
                                {selectedPrices.length > 0 && depositAmount > 0 && (
                                    <Banner tone="info">
                                        <BlockStack gap="200">
                                            {selectedPrices.map((price, index) => {
                                                const deposit = calculateDeposit(price);
                                                const remaining = price - deposit;

                                                return (
                                                    <Text key={index}>
                                                        Product price: <strong>${price.toFixed(2)}</strong> —{" "}
                                                        Pay today: <strong>${deposit.toFixed(2)}</strong> —{" "}
                                                        Remaining: <strong>${remaining.toFixed(2)}</strong>
                                                    </Text>
                                                );
                                            })}
                                        </BlockStack>
                                    </Banner>
                                )}


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
                                        onChange={() => setDueDateType("days")}
                                    />

                                    <RadioButton
                                        label="On a specific date"
                                        helpText="Useful for pre-orders and bookings"
                                        checked={dueDateType === "date"}
                                        value="date"
                                        name="deferredDue"
                                        onChange={() => setDueDateType("date")}
                                    />
                                </BlockStack>


                                {dueDateType === "days" && (
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


                                {dueDateType === "date" && (
                                    <Popover
                                        active={popoverActive}
                                        onClose={() => setPopoverActive(false)}
                                        activator={
                                            <TextField
                                                label="Remaining balance due"
                                                type="text"
                                                readOnly
                                                name="remainingDuedate"
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
                                )}


                            </BlockStack>
                        </Card>
                    </Layout.Section>
                    {/* Submit Button */}
                    {/* <Layout.Section>
                        <Button submit >Save Purchase Option</Button>
                    </Layout.Section> */}
                </Layout>
            </fetcher.Form>
            {fetcher.state === "idle" && fetcher.data?.success && (
                <>
                    {/* {alert("Data submitted successfully!")}
                    {navigate("/app")} */}
                    
                </>
            )}
            <button type="submit" hidden />
{hasUnsavedChanges && (
  <Box
    position="fixed"
    bottom="0"
    left="0"
    width="100%"
    background="bg-surface"
    padding="400"
    borderBlockStartWidth="1"
    borderColor="border"
  >
    <InlineStack align="center" justify="space-between">
      <Text>Unsaved changes</Text>
      {isSaving ? (
        <InlineStack align="center" gap="100">
          <Spinner size="small" style={{ borderTopColor: "#0066FF" }} />
          <Text>Saving...</Text>
        </InlineStack>
      ) : (
        <InlineStack gap="100">
          <Button onClick={discardChanges}>Discard</Button>
          <Button primary submit>
            Save
          </Button>
        </InlineStack>
      )}
    </InlineStack>
  </Box>
)}

            <Outlet />
        </Page>
        </>
    );
}
