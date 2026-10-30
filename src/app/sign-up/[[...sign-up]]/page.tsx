import { SignUp } from "@clerk/nextjs";

import { AuthFrame } from "@/components/auth-frame";
import { PRODUCT_NAME } from "@/lib/product";

export const metadata = { title: `Create an account · ${PRODUCT_NAME}` };

export default function SignUpPage() {
  return (
    <AuthFrame
      headline="Build once, create forever."
      lead="A few photos of you and a few questions about your business. About ten minutes, once. Then talk for two minutes a week and get finished posts."
    >
      <SignUp />
    </AuthFrame>
  );
}
