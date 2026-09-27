"use client";

// Site-wide retrieval downtime bar (spec §4.2). Astryx `Banner` +
// `Button` only — no custom HTML/CSS, no entrance animation (reduced
// motion: mounted-or-not). Announces via the vendor role (alert for
// both error and warning on 0.5.2) without stealing focus.

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";

import {
  recordRetrievalBannerDismissal,
  retrievalBannerView,
  shouldShowRetrievalBanner,
  type RetrievalIncidentCode,
} from "../../lib/retrieval-banner";

export default function RetrievalBanner({
  code,
  envelopeMessage,
  isPersistent = false,
  onRetry,
  onDismissed,
}: {
  code: RetrievalIncidentCode;
  envelopeMessage?: string | null;
  isPersistent?: boolean;
  onRetry: () => void;
  onDismissed?: () => void;
}) {
  if (!shouldShowRetrievalBanner(code)) return null;
  const view = retrievalBannerView({ code, envelopeMessage, isPersistent });
  return (
    <Banner
      status={view.status}
      container={view.container}
      title={view.title}
      description={view.description}
      isDismissable
      dismissLabel={view.dismissLabel}
      onDismiss={() => {
        recordRetrievalBannerDismissal(code);
        onDismissed?.();
      }}
      endContent={<Button label="Retry" variant="ghost" onClick={onRetry} />}
    />
  );
}
