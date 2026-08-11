import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import TrustPage from "@/components/TrustPage";

const policies = {
  about: {
    title: "About World News Simply",
    intro: "World News Simply is an independent website that turns public news reports into concise, accessible briefings.",
    body: (
      <>
        <h2>What we publish</h2>
        <p>We cover major developments in world affairs, politics, technology, business, sport, and health. Briefings link to the reporting they are based on so readers can review the original source.</p>
        <h2>How the site works</h2>
        <p>Technology, including AI-assisted tools, may help summarize source material and improve readability. That assistance can make mistakes. We aim to publish only claims supported by the available source material and to correct errors transparently.</p>
        <h2>Our scope</h2>
        <p>This is a small independent publication, not a large newsroom. We do not claim firsthand reporting unless an article explicitly says so.</p>
      </>
    ),
  },
  contact: {
    title: "Contact",
    intro: "Use the public project channel below for corrections, source concerns, privacy questions, or general feedback.",
    body: (
      <>
        <h2>Get in touch</h2>
        <p><a href="https://github.com/ArhamImdad/world-news-simply/issues" target="_blank" rel="noopener noreferrer">Open a GitHub issue</a>. Do not include private, sensitive, or confidential information because issues are public.</p>
        <h2>Corrections</h2>
        <p>Please include the article URL, the statement you believe is wrong, and a reliable supporting source. See our <Link href="/corrections-policy">Corrections Policy</Link> for the review process.</p>
      </>
    ),
  },
  "editorial-policy": {
    title: "Editorial Policy",
    intro: "Our goal is clear, accurate, appropriately sourced coverage without invented detail or manufactured urgency.",
    body: (
      <>
        <h2>Sourcing and attribution</h2>
        <p>Briefings should identify and link to the original reporting used. We distinguish allegations, estimates, and uncertainty from established facts and avoid presenting another publisher&apos;s reporting as firsthand work.</p>
        <h2>AI assistance</h2>
        <p>AI-assisted tools may help produce drafts. Instructions prohibit invented people, quotes, statistics, dates, locations, and claims. Automation is not a guarantee of accuracy, so readers should consult linked primary reporting for important decisions.</p>
        <h2>Independence and updates</h2>
        <p>Advertising or commercial relationships, if introduced, will not determine factual conclusions. Material corrections are handled under our Corrections Policy.</p>
      </>
    ),
  },
  "corrections-policy": {
    title: "Corrections Policy",
    intro: "We welcome specific, evidence-based reports of errors and aim to correct material inaccuracies promptly.",
    body: (
      <>
        <h2>Requesting a correction</h2>
        <p>Send the article URL, the disputed passage, and a reliable source through our <Link href="/contact">contact channel</Link>. We review whether the published wording is supported by the cited reporting.</p>
        <h2>What happens next</h2>
        <p>Confirmed factual errors should be corrected in the article. Significant changes should be explained clearly rather than silently altering the meaning of a story.</p>
      </>
    ),
  },
  privacy: {
    title: "Privacy Policy",
    intro: "This policy explains the limited information this website and its service providers may process.",
    body: (
      <>
        <h2>Information and cookies</h2>
        <p>Hosting logs may record technical data such as IP address, browser type, requested pages, and timestamps for security and reliability. If analytics is enabled, it may use cookies or similar technologies to measure aggregate site use.</p>
        <h2>Service providers</h2>
        <p>Cloudflare hosts the site, Supabase stores publication data, and external news, image, weather, and media services provide content or data. Their handling of information is governed by their own policies.</p>
        <h2>Advertising</h2>
        <p>The site may use advertising services such as Google AdSense in the future. If enabled, advertising partners may use cookies or similar identifiers for measurement and ad delivery. This page will be updated when advertising is activated and consent controls will be added where legally required.</p>
        <h2>Your choices</h2>
        <p>You can limit cookies through your browser. For privacy questions, use the <Link href="/contact">contact page</Link>.</p>
      </>
    ),
  },
  terms: {
    title: "Terms of Use",
    intro: "By using World News Simply, you agree to use the site lawfully and understand the limits described here.",
    body: (
      <>
        <h2>Informational use</h2>
        <p>Content is provided for general information and may contain errors, omissions, or delays. It is not legal, medical, investment, or other professional advice.</p>
        <h2>Third-party material</h2>
        <p>Links and attributed material may lead to services we do not control. Their availability, accuracy, and terms are their responsibility.</p>
        <h2>Acceptable use</h2>
        <p>Do not interfere with the service, attempt unauthorized access, abuse automated endpoints, or use the site unlawfully. These terms may be updated as the service changes.</p>
      </>
    ),
  },
  disclaimer: {
    title: "Disclaimer",
    intro: "World News Simply provides concise summaries for general awareness, not a substitute for original reporting or professional advice.",
    body: (
      <>
        <h2>Accuracy and timeliness</h2>
        <p>News changes quickly. Although we aim for accurate attribution, automated and human processes can introduce errors. Check linked sources and current official guidance before relying on a briefing.</p>
        <h2>External links and images</h2>
        <p>External links, embedded media, market data, weather data, and images are supplied by third parties and may change or become unavailable.</p>
        <h2>Opinions</h2>
        <p>Clearly labeled opinion material represents analysis or commentary and should not be read as a statement of verified fact beyond its cited evidence.</p>
      </>
    ),
  },
} as const;

type PolicySlug = keyof typeof policies;

export function generateStaticParams() {
  return Object.keys(policies).map((policy) => ({ policy }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ policy: string }> }): Promise<Metadata> {
  const { policy } = await params;
  if (!(policy in policies)) return {};
  const page = policies[policy as PolicySlug];
  return {
    title: page.title,
    description: page.intro,
    alternates: { canonical: `/${policy}` },
  };
}

export default async function PolicyPage({ params }: { params: Promise<{ policy: string }> }) {
  const { policy } = await params;
  if (!(policy in policies)) notFound();
  const page = policies[policy as PolicySlug];
  return <TrustPage title={page.title} intro={page.intro}>{page.body}</TrustPage>;
}
