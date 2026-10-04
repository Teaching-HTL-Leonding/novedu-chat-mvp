import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

// The page shell in a real browser, with the real stylesheet: body is the
// 100dvh flex column, and only PageBody scrolls — the document itself never
// does, or the status bar and the environment ribbon scroll away.
import "@/app/globals.css";
import { Main, PageBody } from "@/components/page-main";

afterEach(async () => {
  await page.viewport(1280, 800);
});

test("an sr-only element below the fold never makes the document scroll", async () => {
  await page.viewport(1280, 600);
  // The render container sits between body and the shell; it continues
  // body's flex column so the chain matches the root layout.
  const container = document.createElement("div");
  container.className = "flex min-h-0 flex-1 flex-col";
  document.body.append(container);

  await render(
    <>
      <header className="h-14 shrink-0">status bar</header>
      <aside className="h-9 shrink-0">environment ribbon</aside>
      <Main>
        <PageBody>
          <div style={{ height: "200vh", flexShrink: 0 }} />
          <section>
            {/* Tailwind's sr-only is position: absolute — like the start
                page calendar's keyboard hint and live region. */}
            <p className="sr-only">Use the arrow keys to move between days.</p>
          </section>
          <div style={{ height: 384, flexShrink: 0 }} />
        </PageBody>
      </Main>
    </>,
    { container },
  );

  const root = document.documentElement;
  expect(root.scrollHeight).toBe(root.clientHeight);
  container.remove();
});
