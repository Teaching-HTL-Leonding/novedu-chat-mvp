import { cva } from "class-variance-authority";

// The dismissible alert box shown above a chat or an answer field: a rejected
// photo (`ImageErrorNotice`) and a failed chat run (`ChatErrorNotice` in
// app/module-chat.tsx). Consumed via cn() for layout deltas (margins, shrink).
export const noticeVariants = cva("rounded-lg border px-3 py-2 text-sm", {
  variants: {
    tone: {
      error: "border-destructive/45 bg-destructive/10",
    },
  },
  defaultVariants: { tone: "error" },
});
