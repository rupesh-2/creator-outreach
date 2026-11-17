"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";

type Action = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

function useToastAction(action: Action) {
  const [state, dispatch, pending] = useActionState(action, null);
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      if (state.message) toast.success(state.message);
    } else toast.error(state.message);
  }, [state]);
  return [dispatch, pending] as const;
}

export function MessageEditor({
  messageId,
  body,
  subject,
  showSubject,
  maxChars,
  approved,
  actions,
}: {
  messageId: string;
  body: string;
  subject?: string | null;
  showSubject?: boolean;
  maxChars?: number;
  approved?: boolean;
  actions: { save: Action; approve: Action; discard: Action };
}) {
  const [save, saving] = useToastAction(actions.save);
  const [approve, approving] = useToastAction(actions.approve);
  const [discard, discarding] = useToastAction(actions.discard);
  const busy = saving || approving || discarding;
  return (
    <form className="space-y-2">
      <input type="hidden" name="messageId" value={messageId} />
      {showSubject && <Input
          name="subject"
          defaultValue={subject ?? ""}
          placeholder="Subject"
          // Enter would trigger the first submit button (Approve); approving should always be an explicit click.
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
        />}
      <Textarea
        name="body"
        defaultValue={body}
        rows={showSubject ? 9 : 5}
        className="text-sm"
        onInput={(e) => {
          const el = e.currentTarget.nextElementSibling;
          if (el && maxChars) el.textContent = `${e.currentTarget.value.length}/${maxChars}`;
        }}
      />
      {maxChars && <div className="text-right text-[11px] text-muted-foreground tabular-nums">{`${body.length}/${maxChars}`}</div>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" formAction={approve} disabled={busy}>
          {approved ? "Re-approve edits" : "Approve"}
        </Button>
        <Button type="submit" size="sm" variant="outline" formAction={save} disabled={busy}>
          Save draft
        </Button>
        <Button type="submit" size="sm" variant="ghost" formAction={discard} disabled={busy}>
          Discard
        </Button>
      </div>
    </form>
  );
}
