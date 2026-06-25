import type { ChatOption } from "@/lib/ai";

/**
 * Tappable quick-reply chips rendered under an assistant message. Replaces the
 * old "type a number" failure mode: the model offers choices as options, the
 * user taps one, and `value` is submitted as their next turn. Phone-first —
 * chips wrap and meet the 44px touch target.
 */
export function QuickReply({
  options,
  onSelect,
  disabled,
}: {
  options: ChatOption[];
  onSelect: (value: string) => void;
  disabled?: boolean;
}) {
  if (options.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map((opt, i) => (
        <button
          key={`${opt.value}-${i}`}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(opt.value)}
          className="min-h-[44px] px-4 py-2 rounded-full border border-border text-sm text-foreground hover:border-border-hover hover:bg-surface-raised transition-colors disabled:opacity-40"
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
