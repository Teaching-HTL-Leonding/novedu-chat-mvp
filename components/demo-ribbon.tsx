import { RibbonFrame } from "@/components/ribbon-frame";

// A demo build's ribbon (docs/auth.md, "Demo mode"), in place of the
// hostname-based environment ribbon. Rendered on the SERVER, so it is in the very
// first HTML — no hydration-time hostname logic — and it has no "×" and reads no
// dismissal key: a tab that once hid the LOCAL ribbon still sees DEMO. The root
// layout loads it by `await import()` inside its demo branch only.
export function DemoRibbon() {
  return (
    <RibbonFrame label="DEMO" className="bg-rose-700 text-white">
      Demo installation — anyone who can reach it can sign in as any demo person. Use sample data
      only, never real student data.
    </RibbonFrame>
  );
}
