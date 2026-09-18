# Webyz marketing site

Next.js App Router: the landing page, pricing (fetched live from the API), the rendered documentation, the blog, the changelog, and the privacy and terms pages. Conventions are in the root `CLAUDE.md` under "Frontend (apps/web)".

```bash
pnpm dev      # http://localhost:3040
pnpm build    # standalone output; NEXT_PUBLIC_* values are inlined, see docs/configuration.md
pnpm lint
```

Legal pages read the operator's facts from `src/lib/legal.ts` (an individual during the beta; switch to a company there when one is registered) and set `reviewed` once a lawyer has read them. Docker image: `apps/web/Dockerfile`.

## Writing a blog post

Add one Markdown file to `content/blog/`. The file name is the URL, so
`content/blog/how-we-count-visitors.md` publishes at `/blog/how-we-count-visitors`,
and a name starting with `_` is a draft that is not published.

```markdown
---
title: How we count visitors
description: One sentence, under 160 characters. It is the meta description and the card blurb.
date: 2026-09-18
author: The Webyz team
tags: [privacy, how-it-works]
---

# How we count visitors

The opening paragraph.

## A section
```

`updated: 2026-10-01` marks a revision, and `cover: /images/post.jpg` with
`coverAlt` adds an image. Everything else in that block is required, the
frontmatter grammar is only what you see here, and a mistake fails the build
with the file and the field named rather than publishing a broken page.

The `# Title` line is stripped when the page renders (the page prints the
frontmatter title as its only H1); keep it so the file reads correctly on
GitHub. Links starting with `/` become internal links, so cross-link posts and
guides freely. Everything else, the social card included, is generated.

## Writing a changelog entry

Release notes at `/changelog` come from `src/lib/changelog.ts`, not from a
Markdown file: add an entry at the top of `RELEASES` and the matching section
to the repository's `CHANGELOG.md`. A `slug` there is a published permalink.
