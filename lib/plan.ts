// Maxxortho customization: self-hosted mode.
// When NEXT_PUBLIC_SELF_HOSTED=true, every user is treated as "pro" and all
// billing / upgrade UI and Stripe routes are disabled. Stripe code stays in
// place (dormant) so upstream merges stay simple.

export const SELF_HOSTED = process.env.NEXT_PUBLIC_SELF_HOSTED === 'true';

export function isPro(status?: string | null): boolean {
  return SELF_HOSTED || status === 'pro';
}
