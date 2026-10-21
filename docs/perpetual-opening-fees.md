# Inclusive perpetual opening fees

A posted margin includes its opening fee. It is the wallet debit, not an extra charge.

Let M be posted margin in cents, L leverage, r the opening rate as a decimal, N the remaining margin and F the opening fee. Exposure is N × L, so F = N × L × r and M = N + F. Solve N = M / (1 + L × r) and F = M × L × r / (1 + L × r).

Round the solved fee half up to whole cents once, using integer rational arithmetic. Assign all remaining cents to N. This conserves the wallet debit exactly. Because collateral is also whole cents, recomputing an unrounded fee on the executed exposure can differ by at most 0.5 cent × (1 + L × r). Do not iterate rounded fees: a rounded fixed point need not exist.

For example, $100 posted at 200x with a 0.05% opening rate gives $9.09 opening fee, $90.91 margin and $18,182 executed notional. A 0.03% flat-price closing fee is $5.45, returned proceeds are $85.46 and net P/L is -$14.54. It does not charge $10 on the original $20,000 gross basis.

If the opening fee is $10, a $100 debit leaves exactly a $90 position. One supported cent-rounded example is 125x at 0.0889%, giving $11,250 executed notional and a $10 fee. Another is $110 posted at 200x and 0.05%, leaving $100 after a $10 fee.

New position margin and collateral are N; postedMargin is M. Both opening and closing rates are locked at entry. Closing fees use the actual exit notional and come from close proceeds, never other wallet cash. Displayed estimated close P/L and realized P/L include both fees. Liquidation cannot lose more than the posted debit; uncovered closing fees are waived as before.

Existing positions keep their stored exposure and opening charge. This change does not resize them or charge their opening fee again.
