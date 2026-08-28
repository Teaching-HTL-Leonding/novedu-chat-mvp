import { Main } from "@/components/page-main";
import { getBuildInfo } from "@/lib/version";
import { ImageCheckClient } from "./image-check-client";

// A support tool, not a feature: when someone reports "the tutor could not read
// my photo", this page tells us what their file and their browser actually are.
// It runs the PRODUCTION normalizer and the production limits, so its verdict is
// the chat's verdict and cannot drift from it.
//
// Signed-in but NOT teacher-only: the whole point is to have the student run it
// on the phone that produced the problem — the device-specific quirks (HEIC, an
// empty MIME type, a missing decoder) are invisible from a teacher's laptop.
// It is covered by the default-deny matcher in proxy.ts like every other page;
// there is no exclusion and no new public surface.
//
// Nothing here reaches the server: the file is read, decoded and re-encoded in
// the browser, and the only thing that leaves the page is a text report the
// visitor copies themselves.
export const dynamic = "force-dynamic";

export default function ImageCheckPage() {
  const build = getBuildInfo();
  return (
    <Main>
      <ImageCheckClient appVersion={`${build.version} (${build.gitSha.slice(0, 8)})`} />
    </Main>
  );
}
