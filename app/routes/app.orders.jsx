import { useEffect, useState } from "react";
import { Page, Card, DataTable, Spinner } from "@shopify/polaris";

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/orderlist")
      .then((res) => res.json())
      .then((data) => {
        setOrders(data);
        setLoading(false);
      });
  }, []);
// useEffect(() => {
//   fetch("/api/orderlist", {
//     method: "GET",
//     credentials: "include", // 🔥 VERY IMPORTANT
//   })
//     .then((res) => {
//       if (!res.ok) {
//         throw new Error("Failed to fetch orders");
//       }
//       return res.json();
//     })
//     .then((data) => {
//       setOrders(data);
//       setLoading(false);
//     })
//     .catch((err) => {
//       console.error("Error:", err);
//       setLoading(false);
//     });
// }, []);

  const rows = orders.map((order) => [
   <a
    href={`https://${order.shop}/admin/orders/${order.order_id}`}
    target="_blank"
    rel="noopener noreferrer"
    style={{
      color: "#1a73e8",
      fontWeight: "600",
      textDecoration: "none",
      cursor: "pointer",
    }}
  >
    {order.order_name}
  </a>,
    order.order_id,
    order.product_title,
    order.quantity,
    order.purchase_option_name,
    new Date(order.created_at).toLocaleDateString(),
    order.order_amount,
  ]);

  return (
    <Page title="Downpay Orders">
      <Card>
        {loading ? (
          <Spinner size="large" />
        ) : (
          <DataTable
            columnContentTypes={["text","text", "text", "numeric", "text", "text","numeric"]}
            headings={["Name","OrderId", "Product", "Qty", "Option", "Date","Amount"]}
            rows={rows}
          />
        )}
      </Card>
    </Page>
  );
}
