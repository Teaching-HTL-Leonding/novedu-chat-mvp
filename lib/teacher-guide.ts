/**
 * Public origin of the teacher guide — a separate static site (teacher-docs/,
 * an Azure Static Web App), not served by this app. The app links to it and
 * permanently redirects the guide's former `/docs/*` paths there
 * (next.config.ts). See docs/teacher-docs.md.
 */
export const TEACHER_GUIDE_URL = "https://docs.novedu.at";
