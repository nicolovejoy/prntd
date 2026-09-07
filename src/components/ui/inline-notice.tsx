export type InlineNoticeTone = "negative" | "neutral";

export type InlineNoticeProps = {
  /** The one line of copy. Always a constant from src/lib/action-copy.ts. */
  message: string;
  /** Optional second line — the raw error text on admin surfaces, where the
   * operator wants the diagnostic. Never used on customer surfaces. */
  hint?: string;
  tone?: InlineNoticeTone;
  className?: string;
  testId?: string;
};

/**
 * One line of result copy next to the control that produced it — the inline
 * half of the alert sweep. Sites whose failing control stays on screen use
 * this; sites on an overlay with no stable anchor use NoticeSheet.
 *
 * The tone→token mapping lives here and nowhere else, so a future palette
 * change is one edit: `text-negative` for a failure, `text-text-muted` for a
 * neutral/success result (admin's "Refund issued.").
 */
export function InlineNotice({
  message,
  hint,
  tone = "negative",
  className = "",
  testId = "inline-notice",
}: InlineNoticeProps) {
  return (
    <p
      data-testid={testId}
      role={tone === "negative" ? "alert" : "status"}
      aria-live="polite"
      className={`text-sm ${tone === "negative" ? "text-negative" : "text-text-muted"} ${className}`}
    >
      {message}
      {hint ? <span className="block text-text-faint">{hint}</span> : null}
    </p>
  );
}
