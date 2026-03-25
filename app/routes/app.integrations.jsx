import { json } from "@remix-run/node";
import { Resend } from "resend";

import { Button } from "@shopify/polaris";

import { Page} from "@shopify/polaris";

import { useAppBridge } from "@shopify/app-bridge-react";

import { useFetcher } from "@remix-run/react";
import { useEffect } from "react";

const resend = new Resend("re_6tSKJdJ9_Pcwv2vHiGgedKr51t5QDqiCC");

// export const action = async ({ request }) => {


//   if (request.method !== "POST") {
//     return json({ error: "Method not allowed" }, { status: 405 });
//   }



//   try {
//     const result = await resend.emails.send({
//       from: "CS <cs@personage.com>",
//       to: ['alienwebsolutions11@gmail.com','ms1386058@gmail.com'],
//       subject: "Hello from CS",
//       html: "<strong>Email sent successfully!  to both </strong>",
//     });

//     return json({ success: true, result });
//   } catch (error) {
//     console.error("Resend error:", error);
//     return json(
//       { success: false, error: error.message },
//       { status: 500 }
//     );
//   }
// };

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const result = await resend.emails.send({
      from: "CS <cs@personage.com>",
      to: ['alienwebsolutions11@gmail.com','ms1386058@gmail.com'], // hardcoded
      subject: "Hello from CS",
      html: "<strong>Email sent successfully! to both the emails, thank you for testing</strong>",
    });

    return json({ success: true, result });
  } catch (error) {
    console.error("Resend error:", error);
    return json({ success: false, error: error.message }, { status: 500 });
  }
};

export default function SendEmailPage() {
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  console.log("🖥 Fetcher state:", fetcher.state);
  console.log("🖥 Fetcher data:", fetcher.data);

  if (fetcher.data?.success) {
    shopify.toast.show("Email sent successfully");
  }

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Email sent successfully");
    }
  }, [fetcher.data, shopify]);

  const sendEmail = () => {
    fetcher.submit(
      {}, // required by action
      {
        method: "POST",
        encType: "application/json",
      }
    );
  };

  return (
    <Page>
      <Button
        loading={fetcher.state === "submitting"}
        onClick={sendEmail}
      >
        Send Email
      </Button>
    </Page>
  );
}

