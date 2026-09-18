import { ImageResponse } from "next/og";

import { getPost, getPosts, formatPostDate } from "../../../lib/blog";

/**
 * The card a post gets when it is shared. Generated per post at build time
 * from the title, so a new post never ships with a stale or generic image and
 * no one has to open a design tool to publish.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "A Webyz blog post";

export function generateStaticParams() {
  return getPosts().then((posts) => posts.map((post) => ({ slug: post.slug })));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#ffffff",
          padding: "72px",
          // The brand blue as a band down the left edge, the one piece of
          // colour, so the card is recognisable at thumbnail size.
          borderLeft: "24px solid #4f75fe",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div style={{ width: 20, height: 20, borderRadius: 6, background: "#4f75fe" }} />
          <div style={{ fontSize: 30, fontWeight: 700, color: "#2d2323", letterSpacing: "-0.02em" }}>webyz</div>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: post && post.title.length > 58 ? 58 : 70,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: "-0.03em",
            color: "#2d2323",
          }}
        >
          {post?.title ?? "The Webyz blog"}
        </div>

        <div style={{ display: "flex", fontSize: 26, color: "#8a7878" }}>
          {post ? `${formatPostDate(post.date)}  ·  ${post.readingMinutes} min read` : "webyz.io/blog"}
        </div>
      </div>
    ),
    size,
  );
}
