import type { ClaimKind, Trust, Visibility } from "../../src/sdk";
import { CLAIM_KINDS, TRUST_LEVELS, VISIBILITIES } from "../../src/core/validate";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;

const claimKindsStayCanonical: Equal<ClaimKind, (typeof CLAIM_KINDS)[number]> = true;
const trustStaysCanonical: Equal<Trust, (typeof TRUST_LEVELS)[number]> = true;
const visibilityStaysCanonical: Equal<Visibility, (typeof VISIBILITIES)[number]> = true;

void [claimKindsStayCanonical, trustStaysCanonical, visibilityStaysCanonical];
