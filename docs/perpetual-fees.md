# Perpetual trading fees

The persistent admin setting defaults to zero. No rate is enabled by this change. Spot orders are unchanged. Only identities verified from Clerk privateMetadata.admin can change the rate; changes use the existing audited, receipt-deduplicated room CAS transaction.

Rates range from 0 to 0.1 percent per side in increments of 0.0001 percent. New positions lock the displayed rate for both legs. Existing positions without a rate, or opened at zero, remain fee-free on close, even after an admin changes the setting. A stale order cannot open at an undisclosed rate.

Opening fee is based on margin times leverage and is paid in addition to isolated margin. Closing fee uses that position's actual exit notional, margin times leverage times exit price divided by entry price. Integer arithmetic rounds each final fee to the nearest cent, halves up, without first rounding notional. Partial perpetual closes are not supported by the existing execution model.

Manual, TP and SL settlements share the same financial path. Net realized P/L includes both fees. The closing fee is capped to isolated proceeds. Liquidation reserves the closing rate in its threshold and retains the existing all-margin-forfeiture policy. Its fee is an allocation inside forfeited margin, not an additional cash charge; uncovered gap fees are explicitly waived. Changing maintenance or a host liquidation override can still immediately liquidate positions, as before. Trigger P/L previews remain before fees.

The house ledger contains total trading profit/loss and fees, not a separate revenue account. Actual opening/closing charges and gap waivers are retained per closed position. Historical gross mark-to-market P/L is not invented for liquidation forfeitures.

Validation includes fee bounds/precision/rounding, both directions, stale consent, isolated cash safety, duplicate position IDs, grandfathering, manual/TP/SL/liquidation, real Mongo CAS races and persistence, private socket snapshots, wire size, and hydrated desktop/mobile UI. All QA is in the dedicated Kat sandbox; no production data or Windows services are changed.
