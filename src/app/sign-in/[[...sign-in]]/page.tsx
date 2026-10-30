import { SignIn } from "@clerk/nextjs";

import { AuthFrame } from "@/components/auth-frame";
import { PRODUCT_NAME } from "@/lib/product";

export const metadata = { title: `Sign in · ${PRODUCT_NAME}` };

export default function SignInPage() {
  return (
    <AuthFrame
      headline="Get more clients from social media, without spending hours creating content."
      lead="Your content, done for you by your own AI, in your voice and with your face. No filming. No editing. No prompts."
    >
      <SignIn />
    </AuthFrame>
  );
}
